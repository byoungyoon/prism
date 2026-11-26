//! 대시보드 백엔드. 연결 종류(칸)마다 파일을 나눠서, 새 서비스는 파일 하나를 추가해 붙인다.
//!
//! - `layout`: 배치 저장(dashboard.json), AI 설계도 검사
//! - `web`: 웹사이트 칸 (메인 창 안의 자식 웹뷰)
//! - `sheet`: 엑셀/CSV 칸 (읽기, 파일 변경 감시)
//! - `slack`: 슬랙 칸 (읽기 전용, 토큰은 키체인에만)
//! - `ai`: AI로 보기 바꾸기, 말로 설명한 대시보드 초안

pub mod ai;
pub mod layout;
pub mod sheet;
pub mod slack;
pub mod web;

use std::fs;
use std::path::Path;

/// 칸 번호(widgetId). 웹뷰 라벨(`dash-web-{id}`)에 들어가므로 영숫자와 `-`만 허용한다.
pub fn valid_widget_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

pub fn check_widget_id(id: &str) -> Result<(), String> {
    if valid_widget_id(id) {
        Ok(())
    } else {
        Err("칸 번호가 맞지 않아요. 영문·숫자·-만 쓸 수 있어요".into())
    }
}

/// 임시 파일에 쓴 뒤 이름을 바꿔서 저장한다. 쓰다가 멈춰도 원래 파일은 깨지지 않는다.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|_| "저장 폴더를 만들지 못했어요".to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, bytes).map_err(|_| "파일을 저장하지 못했어요".to_string())?;
    fs::rename(&tmp, path).map_err(|_| "파일을 저장하지 못했어요".to_string())
}

#[cfg(test)]
mod tests {
    use super::valid_widget_id;

    #[test]
    fn widget_id_allows_only_alnum_and_dash() {
        assert!(valid_widget_id("w1"));
        assert!(valid_widget_id("abc-123"));
        assert!(!valid_widget_id(""));
        assert!(!valid_widget_id("a b"));
        assert!(!valid_widget_id("../etc"));
        assert!(!valid_widget_id("a\"b"));
        assert!(!valid_widget_id("a_b"));
        assert!(!valid_widget_id(&"a".repeat(65)));
    }
}
