//! 엑셀/CSV 칸: 파일 읽기와 파일 변경 감시.
//!
//! - .csv/.tsv는 직접 파싱한다(따옴표, UTF-8 BOM, EUC-KR(CP949)). 기본은 UTF-8, 아니면 EUC-KR.
//! - .xlsx/.xls 등은 calamine으로 첫 시트를 읽는다.
//! - 최대 5000행(머리글 제외). 넘으면 `truncated: true`.
//! - 감시는 2초마다 파일의 수정 시각과 크기를 보고, 바뀌면 `dashboard://sheet-changed`를 보낸다.

use std::collections::BTreeMap;
use std::ffi::OsStr;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use calamine::{open_workbook_auto, Reader};
use encoding_rs::{EUC_KR, UTF_16LE};
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};

pub const MAX_ROWS: usize = 5000;
const WATCH_EVERY: Duration = Duration::from_secs(2);
const EVENT: &str = "dashboard://sheet-changed";

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SheetData {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub sheet_name: Option<String>,
    pub truncated: bool,
}

/// 글자 바이트를 문자열로. BOM 제거, UTF-16 LE, UTF-8, 나머지는 EUC-KR(CP949)로 본다.
pub fn decode_text(bytes: &[u8]) -> String {
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        return UTF_16LE.decode_without_bom_handling(rest).0.into_owned();
    }
    let body = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    match std::str::from_utf8(body) {
        Ok(s) => s.to_string(),
        Err(_) => EUC_KR.decode_without_bom_handling(body).0.into_owned(),
    }
}

/// 구분자로 나눈다. 큰따옴표로 감싼 칸(안의 구분자·줄바꿈 포함, `""`는 `"`), CRLF를 처리한다.
/// 모두 빈 줄은 버린다.
pub fn parse_delimited(text: &str, delim: char) -> Vec<Vec<String>> {
    let mut rows: Vec<Vec<String>> = vec![];
    let mut row: Vec<String> = vec![];
    let mut field = String::new();
    let mut in_quotes = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    field.push('"');
                    chars.next();
                } else {
                    in_quotes = false;
                }
            } else {
                field.push(c);
            }
        } else if c == '"' && field.is_empty() {
            in_quotes = true;
        } else if c == delim {
            row.push(std::mem::take(&mut field));
        } else if c == '\n' {
            row.push(std::mem::take(&mut field));
            rows.push(std::mem::take(&mut row));
        } else if c == '\r' {
            // CRLF의 CR은 무시
        } else {
            field.push(c);
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    rows.retain(|r| r.iter().any(|c| !c.is_empty()));
    rows
}

fn to_table(rows: Vec<Vec<String>>, sheet_name: Option<String>) -> SheetData {
    let mut iter = rows.into_iter();
    let headers = iter.next().unwrap_or_default();
    let mut data: Vec<Vec<String>> = iter.collect();
    let truncated = data.len() > MAX_ROWS;
    data.truncate(MAX_ROWS);
    SheetData { headers, rows: data, sheet_name, truncated }
}

fn read_delimited(path: &Path, delim: char) -> Result<SheetData, String> {
    let bytes = fs::read(path).map_err(|_| "파일을 읽지 못했어요".to_string())?;
    Ok(to_table(parse_delimited(&decode_text(&bytes), delim), None))
}

fn read_workbook(path: &Path) -> Result<SheetData, String> {
    let mut wb = open_workbook_auto(path)
        .map_err(|_| "엑셀 파일을 열 수 없어요. 파일이 깨졌거나 암호가 걸려 있을 수 있어요".to_string())?;
    let name = wb.sheet_names().first().cloned().ok_or_else(|| "시트가 없는 파일이에요".to_string())?;
    let range = wb.worksheet_range(&name).map_err(|_| "첫 시트를 읽지 못했어요".to_string())?;
    // 머리글 1 + 최대 행 + 넘는지 알기 위한 1
    let rows: Vec<Vec<String>> = range
        .rows()
        .take(MAX_ROWS + 2)
        .map(|r| r.iter().map(|c| c.to_string()).collect())
        .collect();
    Ok(to_table(rows, Some(name)))
}

/// 경로의 파일을 읽는다(동기). 명령은 `sheet_read`가 백그라운드에서 부른다.
pub fn read_file(path: &Path) -> Result<SheetData, String> {
    if !path.is_file() {
        return Err("파일을 찾을 수 없어요".into());
    }
    let ext = path.extension().and_then(OsStr::to_str).unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "csv" => read_delimited(path, ','),
        "tsv" => read_delimited(path, '\t'),
        "xlsx" | "xlsm" | "xls" | "xlsb" | "ods" => read_workbook(path),
        _ => Err("CSV, TSV, 엑셀(xlsx·xls) 파일만 열 수 있어요".into()),
    }
}

#[tauri::command]
pub async fn sheet_read(path: String) -> Result<SheetData, String> {
    tauri::async_runtime::spawn_blocking(move || read_file(Path::new(&path)))
        .await
        .map_err(|_| "파일을 읽는 중에 멈췄어요".to_string())?
}

// ── 파일 변경 감시 ─────────────────────────────────────

type Stamp = (SystemTime, u64);

struct Watch {
    path: String,
    stamp: Option<Stamp>,
}

static WATCHES: Mutex<BTreeMap<String, Watch>> = Mutex::new(BTreeMap::new());
static POLLING: AtomicBool = AtomicBool::new(false);

fn stamp(path: &str) -> Option<Stamp> {
    let meta = fs::metadata(path).ok()?;
    Some((meta.modified().ok()?, meta.len()))
}

/// 감시 목록에서 바뀐 파일(칸 번호, 경로)을 골라 낸다. 같은 변경은 한 번만 알린다.
fn changed(watches: &mut BTreeMap<String, Watch>) -> Vec<(String, String)> {
    let mut out = vec![];
    for (id, w) in watches.iter_mut() {
        let now = stamp(&w.path);
        if now != w.stamp {
            w.stamp = now;
            if now.is_some() {
                out.push((id.clone(), w.path.clone()));
            }
        }
    }
    out
}

fn start_polling(app: AppHandle) {
    if POLLING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || loop {
        std::thread::sleep(WATCH_EVERY);
        let events = changed(&mut WATCHES.lock().unwrap_or_else(|e| e.into_inner()));
        for (widget_id, path) in events {
            let _ = app.emit(EVENT, json!({ "widgetId": widget_id, "path": path }));
        }
    });
}

#[tauri::command]
pub fn sheet_watch(app: AppHandle, widget_id: String, path: String) -> Result<(), String> {
    super::check_widget_id(&widget_id)?;
    let watch = Watch { stamp: stamp(&path), path };
    WATCHES.lock().unwrap_or_else(|e| e.into_inner()).insert(widget_id, watch);
    start_polling(app);
    Ok(())
}

#[tauri::command]
pub fn sheet_unwatch(widget_id: String) -> Result<(), String> {
    WATCHES.lock().unwrap_or_else(|e| e.into_inner()).remove(&widget_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &str) -> String {
        v.to_string()
    }

    #[test]
    fn parses_quotes_commas_and_newlines_inside_fields() {
        let text = "이름,메모\r\n\"김, 철수\",\"줄1\n줄2\"\r\n\"그는 \"\"좋다\"\"\",끝\r\n";
        let rows = parse_delimited(text, ',');
        assert_eq!(rows[0], vec![s("이름"), s("메모")]);
        assert_eq!(rows[1], vec![s("김, 철수"), s("줄1\n줄2")]);
        assert_eq!(rows[2], vec![s("그는 \"좋다\""), s("끝")]);
        assert_eq!(rows.len(), 3);
    }

    #[test]
    fn tsv_uses_tab_and_blank_lines_are_dropped() {
        let rows = parse_delimited("a\tb\n\n1\t2\n\n", '\t');
        assert_eq!(rows, vec![vec![s("a"), s("b")], vec![s("1"), s("2")]]);
    }

    #[test]
    fn utf8_bom_is_removed_before_the_header() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend("이름,점수\n홍길동,90\n".as_bytes());
        let text = decode_text(&bytes);
        assert!(text.starts_with("이름"));
        let rows = parse_delimited(&text, ',');
        assert_eq!(rows[0][0], "이름");
    }

    #[test]
    fn cp949_bytes_are_decoded() {
        let (encoded, _, _) = EUC_KR.encode("이름,서울\n홍길동,강남\n");
        assert!(std::str::from_utf8(&encoded).is_err(), "test bytes must not be valid UTF-8");
        let rows = parse_delimited(&decode_text(&encoded), ',');
        assert_eq!(rows, vec![vec![s("이름"), s("서울")], vec![s("홍길동"), s("강남")]]);
    }

    #[test]
    fn table_splits_header_and_truncates_at_limit() {
        let mut rows = vec![vec![s("h")]];
        for i in 0..(MAX_ROWS + 3) {
            rows.push(vec![i.to_string()]);
        }
        let t = to_table(rows, None);
        assert_eq!(t.headers, vec![s("h")]);
        assert_eq!(t.rows.len(), MAX_ROWS);
        assert!(t.truncated);
        assert!(t.sheet_name.is_none());
    }

    #[test]
    fn exact_limit_is_not_truncated() {
        let mut rows = vec![vec![s("h")]];
        for i in 0..MAX_ROWS {
            rows.push(vec![i.to_string()]);
        }
        assert!(!to_table(rows, None).truncated);
    }

    #[test]
    fn unknown_extension_is_refused() {
        let err = read_file(Path::new("/definitely/not/here.csv")).unwrap_err();
        assert!(err.contains("찾을 수 없어요"));
    }

    #[test]
    fn change_is_reported_once_and_missing_file_is_not_reported() {
        let dir = std::env::temp_dir().join(format!("prism-sheet-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("data.csv");
        fs::write(&file, "a\n1\n").unwrap();
        let p = file.to_string_lossy().to_string();
        let mut map = BTreeMap::new();
        map.insert("w1".to_string(), Watch { stamp: stamp(&p), path: p.clone() });
        assert!(changed(&mut map).is_empty(), "no change yet");
        fs::write(&file, "a\n1\n2\n").unwrap();
        assert_eq!(changed(&mut map), vec![("w1".to_string(), p.clone())]);
        assert!(changed(&mut map).is_empty(), "reported once");
        fs::remove_file(&file).unwrap();
        assert!(changed(&mut map).is_empty(), "deleted file is not reported");
        fs::remove_dir_all(&dir).ok();
    }
}
