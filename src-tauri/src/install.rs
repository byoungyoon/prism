//! "I got the new version but the old one shows up" (macOS). Three ways that happens:
//!   · the new app was installed over a running one: macOS only brings the old process forward
//!     → the running app sees that its own bundle on disk is newer ("replaced")
//!   · another version of Prism is already running (from another folder)
//!   · the app was opened from the DMG / Downloads: an old copy, or one that can't update itself
//! `install_check` names the one that applies; `install_fix` does the one-button repair.

use std::cmp::Ordering;
use std::path::{Path, PathBuf};
use std::process::Command;

const BUNDLE_ID: &str = "dev.byoungyoon.prism";
const EXE_IN_BUNDLE: &str = "/Contents/MacOS/prism";
const MINE: &str = env!("CARGO_PKG_VERSION");

#[derive(serde::Serialize, serde::Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    /// a newer version was put where this app runs from; this process is still the old one
    Replaced,
    /// this is the older one: a newer Prism is already running
    NewerRunning,
    /// an older Prism is still running
    OldRunning,
    /// opened outside Applications while Applications has a Prism that is as new or newer
    OpenInstalled,
    /// opened outside Applications and Applications has none (or an older one)
    Move,
}

#[derive(serde::Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub kind: Kind,
    /// the version that is running right now (this window)
    pub version: String,
    /// the other one's version, when it can be told
    pub other: Option<String>,
    /// where this app was opened from, in plain words ("다운로드 폴더") — only outside Applications
    pub place: Option<&'static str>,
}

/// Another Prism process.
#[derive(Clone, Debug, PartialEq)]
struct Running {
    pid: u32,
    bundle: PathBuf,
    /// None: it can't be told (its app was replaced or removed after it started — so it's an old one)
    version: Option<String>,
}

struct Facts {
    mine: String,
    /// version of the bundle on disk at the path this app runs from
    on_disk: Option<String>,
    /// None when installed in Applications, else where it runs from
    outside: Option<&'static str>,
    /// the Prism in Applications (not this one)
    installed: Option<(PathBuf, String)>,
    others: Vec<Running>,
}

fn compare(a: &str, b: &str) -> Ordering {
    let parts = |v: &str| v.split('.').map(|p| p.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    parts(a).cmp(&parts(b))
}

fn is_older(r: &Running, mine: &str) -> bool {
    r.version.as_deref().is_none_or(|v| compare(v, mine) == Ordering::Less)
}

fn decide(f: &Facts) -> Option<(Kind, Option<String>)> {
    if let Some(v) = f.on_disk.as_deref().filter(|v| compare(v, &f.mine) == Ordering::Greater) {
        return Some((Kind::Replaced, Some(v.to_string())));
    }
    if let Some(r) = f.others.iter().find(|r| r.version.as_deref().is_some_and(|v| compare(v, &f.mine) == Ordering::Greater)) {
        return Some((Kind::NewerRunning, r.version.clone()));
    }
    if let Some(r) = f.others.iter().find(|r| is_older(r, &f.mine)) {
        return Some((Kind::OldRunning, r.version.clone()));
    }
    f.outside?;
    match &f.installed {
        Some((_, v)) if compare(v, &f.mine) != Ordering::Less => Some((Kind::OpenInstalled, Some(v.clone()))),
        other => Some((Kind::Move, other.as_ref().map(|(_, v)| v.clone()))),
    }
}

/// `…/Prism.app/Contents/MacOS/prism` → `…/Prism.app`. None for a development build.
fn bundle_of(exe: &Path) -> Option<PathBuf> {
    let bundle = exe.to_str()?.strip_suffix(EXE_IN_BUNDLE)?;
    bundle.ends_with(".app").then(|| PathBuf::from(bundle))
}

/// None when `bundle` is in an Applications folder, else where it is, in plain words.
fn outside_applications(bundle: &Path, home: &Path) -> Option<&'static str> {
    if bundle.starts_with("/Applications") || bundle.starts_with(home.join("Applications")) {
        return None;
    }
    let text = bundle.to_string_lossy();
    Some(if text.contains("/AppTranslocation/") {
        // macOS runs a freshly downloaded app from a hidden read-only copy
        "내려받은 파일 그대로"
    } else if text.starts_with("/Volumes/") {
        "설치 파일(DMG) 안"
    } else if bundle.starts_with(home.join("Downloads")) {
        "다운로드 폴더"
    } else {
        "응용 프로그램 폴더가 아닌 곳"
    })
}

/// A string value from an XML Info.plist.
fn plist_value(text: &str, key: &str) -> Option<String> {
    let rest = text.split_once(&format!("<key>{key}</key>"))?.1;
    let rest = rest.trim_start().strip_prefix("<string>")?;
    Some(rest.split_once("</string>")?.0.to_string())
}

/// The version of the Prism bundle at `bundle`; None when it isn't there or isn't Prism.
fn bundle_version(bundle: &Path) -> Option<String> {
    let text = std::fs::read_to_string(bundle.join("Contents/Info.plist")).ok()?;
    (plist_value(&text, "CFBundleIdentifier")? == BUNDLE_ID).then(|| plist_value(&text, "CFBundleShortVersionString"))?
}

/// `ps -xwwo pid=,command=` → (pid, bundle) of every running Prism app, without `me` and without
/// the helper processes (`--mcp-bridge`, the same program run by an agent).
fn parse_ps(text: &str, me: u32) -> Vec<(u32, PathBuf)> {
    text.lines()
        .filter_map(|line| {
            let (pid, command) = line.trim_start().split_once(char::is_whitespace)?;
            let pid: u32 = pid.parse().ok()?;
            let command = command.trim_start();
            let at = command.find(EXE_IN_BUNDLE)?;
            let args = &command[at + EXE_IN_BUNDLE.len()..];
            if pid == me || !(args.is_empty() || args.starts_with(' ')) || args.contains("--mcp-bridge") {
                return None;
            }
            // the program itself, not a command that merely mentions its path
            let bundle = &command[..at];
            (command.starts_with('/') && bundle.ends_with(".app") && !bundle.contains(" /")).then(|| (pid, PathBuf::from(bundle)))
        })
        .collect()
}

fn output(program: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(program).args(args).output().ok()?;
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// The inode of the program file process `pid` was started from.
fn running_inode(pid: u32) -> Option<u64> {
    // -Fin: one field per line; the first "txt" file is the program itself
    let text = output("/usr/sbin/lsof", &["-a", "-p", &pid.to_string(), "-d", "txt", "-Fin"])?;
    let mut inode = None;
    for line in text.lines() {
        if let Some(i) = line.strip_prefix('i') {
            inode = i.parse().ok();
        } else if line.strip_prefix('n').is_some_and(|n| n.ends_with(EXE_IN_BUNDLE)) {
            return inode;
        }
    }
    None
}

/// Does the file at `bundle` still hold the program process `pid` runs?
#[cfg(unix)]
fn same_program(pid: u32, bundle: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    let exe = PathBuf::from(format!("{}{EXE_IN_BUNDLE}", bundle.display()));
    let Ok(on_disk) = std::fs::metadata(exe) else { return false };
    // when lsof can't tell, believe the files
    running_inode(pid).is_none_or(|i| i == on_disk.ino())
}

/// Only macOS is checked (see `my_bundle`).
#[cfg(not(unix))]
fn same_program(_pid: u32, _bundle: &Path) -> bool {
    true
}

fn other_prisms() -> Vec<Running> {
    let Some(ps) = output("/bin/ps", &["-xwwo", "pid=,command="]) else { return vec![] };
    parse_ps(&ps, std::process::id())
        .into_iter()
        .filter_map(|(pid, bundle)| {
            let there = bundle.join("Contents/Info.plist").exists();
            let version = bundle_version(&bundle);
            // another app that happens to ship a "prism" program
            if there && version.is_none() {
                return None;
            }
            let version = version.filter(|_| same_program(pid, &bundle));
            Some(Running { pid, bundle, version })
        })
        .collect()
}

fn applications_dirs(home: &Path) -> [PathBuf; 2] {
    [PathBuf::from("/Applications"), home.join("Applications")]
}

/// This app's bundle, when the check applies: a released build on macOS.
fn my_bundle() -> Option<PathBuf> {
    if !cfg!(target_os = "macos") || cfg!(debug_assertions) {
        return None;
    }
    bundle_of(&std::env::current_exe().ok()?)
}

fn gather(bundle: &Path) -> Facts {
    let home = std::env::home_dir().unwrap_or_default();
    let installed = applications_dirs(&home)
        .into_iter()
        .map(|d| d.join("Prism.app"))
        .filter(|p| p != bundle)
        .find_map(|p| bundle_version(&p).map(|v| (p, v)));
    Facts {
        mine: MINE.to_string(),
        on_disk: bundle_version(bundle),
        outside: outside_applications(bundle, &home),
        installed,
        others: other_prisms(),
    }
}

fn current_issue() -> Option<(Issue, PathBuf, Facts)> {
    let bundle = my_bundle()?;
    let facts = gather(&bundle);
    let (kind, other) = decide(&facts)?;
    let issue = Issue { kind, version: facts.mine.clone(), other, place: facts.outside };
    Some((issue, bundle, facts))
}

/// Copy the app at `source` to `target`. What was at `target` goes to `trash`; if anything fails,
/// `target` is left as it was.
fn install_copy(source: &Path, target: &Path, trash: &Path) -> Result<(), String> {
    let dir = target.parent().ok_or("옮길 곳을 찾지 못했어요")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let staging = dir.join(format!(".Prism-new-{}.app", std::process::id()));
    let _ = std::fs::remove_dir_all(&staging);
    let copied = Command::new("/usr/bin/ditto").arg(source).arg(&staging).status().map(|s| s.success()).unwrap_or(false);
    if !copied {
        let _ = std::fs::remove_dir_all(&staging);
        return Err("응용 프로그램 폴더에 복사하지 못했어요".into());
    }
    let mut old = None;
    if target.exists() {
        let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S%3f");
        let aside = trash.join(format!("Prism 예전 버전 {stamp}.app"));
        if let Err(e) = std::fs::create_dir_all(trash).and_then(|_| std::fs::rename(target, &aside)) {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(format!("예전 Prism을 휴지통으로 옮기지 못했어요: {e}"));
        }
        old = Some(aside);
    }
    if let Err(e) = std::fs::rename(&staging, target) {
        if let Some(aside) = old {
            let _ = std::fs::rename(aside, target);
        }
        let _ = std::fs::remove_dir_all(&staging);
        return Err(format!("응용 프로그램 폴더에 넣지 못했어요: {e}"));
    }
    // the person already opened this app; without the download mark macOS would run the copy from a
    // hidden read-only place again
    let _ = Command::new("/usr/bin/xattr").args(["-dr", "com.apple.quarantine"]).arg(target).status();
    Ok(())
}

/// Ask the processes to quit and wait until they're gone.
fn close_processes(pids: &[u32]) -> Result<(), String> {
    let alive = |pid: &u32| Command::new("/bin/kill").args(["-0", &pid.to_string()]).output().map(|o| o.status.success()).unwrap_or(false);
    for pid in pids {
        let _ = Command::new("/bin/kill").args(["-TERM", &pid.to_string()]).output();
    }
    for _ in 0..50 {
        if !pids.iter().any(alive) {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    Err("예전 Prism이 닫히지 않았어요. Dock에서 예전 Prism을 직접 끈 뒤 다시 열어 주세요.".into())
}

/// What the app should do after the repair.
pub enum Then {
    /// stay open (look again)
    Stay,
    /// save the teams as for an update, then start again (the new version at the same path)
    RestartSaving,
    /// start again without saving: another Prism's saved state is newer than what this one read
    RestartClean,
    /// go to the app at `bundle` (`running`: it's already open) and quit without saving
    SwitchTo { bundle: PathBuf, running: bool },
}

/// Open the app at `bundle`, or bring it forward when it's `running`. Call right before quitting.
pub fn open_app(bundle: &Path, running: bool) -> Result<(), String> {
    let failed = "Prism을 열지 못했어요. 응용 프로그램 폴더에서 직접 열어 주세요.";
    let ok = if running {
        // once this window is gone, so macOS brings that one forward rather than this one
        Command::new("/bin/sh").args(["-c", "sleep 1; exec /usr/bin/open \"$1\"", "sh"]).arg(bundle).spawn().is_ok()
    } else {
        // -n: without it macOS may only bring this app (same identifier) forward
        Command::new("/usr/bin/open").arg("-n").arg(bundle).status().map(|s| s.success()).unwrap_or(false)
    };
    ok.then_some(()).ok_or_else(|| failed.into())
}

/// Do the repair for `kind`. `working`: members at work in this window right now.
pub fn repair(kind: Kind, working: usize) -> Result<Then, String> {
    let Some((issue, bundle, facts)) = current_issue() else { return Ok(Then::Stay) };
    // things changed since the notice was shown: show the new one instead of doing something else
    if issue.kind != kind {
        return Ok(Then::Stay);
    }
    match kind {
        Kind::Replaced => Ok(Then::RestartSaving),
        Kind::NewerRunning => {
            let newer = facts.others.iter().find(|r| r.version == issue.other).ok_or("새 Prism을 찾지 못했어요")?;
            Ok(Then::SwitchTo { bundle: newer.bundle.clone(), running: true })
        }
        Kind::OldRunning => {
            let old: Vec<u32> = facts.others.iter().filter(|r| is_older(r, &facts.mine)).map(|r| r.pid).collect();
            close_processes(&old)?;
            // starting again reads what the old one saved last; not when this window has work going
            Ok(if working == 0 { Then::RestartClean } else { Then::Stay })
        }
        Kind::OpenInstalled => {
            let (path, _) = facts.installed.ok_or("설치된 Prism을 찾지 못했어요")?;
            let running = facts.others.iter().any(|r| r.bundle == path);
            Ok(Then::SwitchTo { bundle: path, running })
        }
        Kind::Move => {
            let home = std::env::home_dir().ok_or("홈 폴더를 찾지 못했어요")?;
            let target = facts.installed.map(|(p, _)| p).unwrap_or_else(|| PathBuf::from("/Applications/Prism.app"));
            // never put a running app in the trash
            if facts.others.iter().any(|r| r.bundle == target) {
                return Err("응용 프로그램 폴더의 Prism이 켜져 있어요. 그 Prism을 끈 뒤 다시 눌러 주세요.".into());
            }
            install_copy(&bundle, &target, &home.join(".Trash"))
                .map_err(|e| format!("{e}. Finder에서 Prism을 '응용 프로그램' 폴더로 끌어다 놓아 주세요."))?;
            Ok(Then::SwitchTo { bundle: target, running: false })
        }
    }
}

pub fn check() -> Option<Issue> {
    current_issue().map(|(issue, _, _)| issue)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts() -> Facts {
        Facts { mine: "0.3.9".into(), on_disk: Some("0.3.9".into()), outside: None, installed: None, others: vec![] }
    }

    fn running(version: Option<&str>) -> Running {
        Running { pid: 7, bundle: "/Users/a/Downloads/Prism.app".into(), version: version.map(String::from) }
    }

    #[test]
    fn nothing_to_say_when_installed_and_alone() {
        assert_eq!(decide(&facts()), None);
        // the same version twice isn't "an old one showing up"
        assert_eq!(decide(&Facts { others: vec![running(Some("0.3.9"))], ..facts() }), None);
    }

    #[test]
    fn versions_compare_as_numbers() {
        assert_eq!(compare("0.3.10", "0.3.9"), Ordering::Greater);
        assert_eq!(compare("0.3.9", "0.3.9"), Ordering::Equal);
    }

    #[test]
    fn a_newer_app_put_in_place_comes_first() {
        let f = Facts { on_disk: Some("0.4.0".into()), others: vec![running(Some("0.3.1"))], ..facts() };
        assert_eq!(decide(&f), Some((Kind::Replaced, Some("0.4.0".into()))));
    }

    #[test]
    fn tells_which_of_two_running_ones_is_old() {
        let newer = Facts { others: vec![running(Some("0.4.0"))], ..facts() };
        assert_eq!(decide(&newer), Some((Kind::NewerRunning, Some("0.4.0".into()))));
        let older = Facts { others: vec![running(Some("0.3.7"))], outside: Some("다운로드 폴더"), ..facts() };
        assert_eq!(decide(&older), Some((Kind::OldRunning, Some("0.3.7".into()))));
        // its app was replaced under it: whatever it is, it started before this one's files
        assert_eq!(decide(&Facts { others: vec![running(None)], ..facts() }), Some((Kind::OldRunning, None)));
    }

    #[test]
    fn outside_applications_opens_the_installed_one_or_moves() {
        let out = || Facts { outside: Some("다운로드 폴더"), ..facts() };
        let installed = |v: &str| Some((PathBuf::from("/Applications/Prism.app"), v.to_string()));
        assert_eq!(decide(&out()), Some((Kind::Move, None)));
        assert_eq!(decide(&Facts { installed: installed("0.3.7"), ..out() }), Some((Kind::Move, Some("0.3.7".into()))));
        assert_eq!(decide(&Facts { installed: installed("0.4.0"), ..out() }), Some((Kind::OpenInstalled, Some("0.4.0".into()))));
        assert_eq!(decide(&Facts { installed: installed("0.3.9"), ..out() }), Some((Kind::OpenInstalled, Some("0.3.9".into()))));
    }

    #[test]
    fn knows_where_it_was_opened_from() {
        let home = Path::new("/Users/a");
        let at = |p: &str| outside_applications(Path::new(p), home);
        assert_eq!(at("/Applications/Prism.app"), None);
        assert_eq!(at("/Users/a/Applications/Prism.app"), None);
        assert_eq!(at("/Volumes/Prism/Prism.app"), Some("설치 파일(DMG) 안"));
        assert_eq!(at("/Users/a/Downloads/Prism.app"), Some("다운로드 폴더"));
        assert_eq!(at("/private/var/folders/x/T/AppTranslocation/1-2/d/Prism.app"), Some("내려받은 파일 그대로"));
        assert_eq!(at("/Users/a/Desktop/Prism.app"), Some("응용 프로그램 폴더가 아닌 곳"));
    }

    #[test]
    fn a_development_build_is_not_checked() {
        assert_eq!(bundle_of(Path::new("/w/target/debug/prism")), None);
        assert_eq!(bundle_of(Path::new("/Applications/Prism.app/Contents/MacOS/prism")), Some("/Applications/Prism.app".into()));
    }

    #[test]
    fn finds_other_prism_apps_in_the_process_list() {
        let ps = "  10 /Applications/Prism.app/Contents/MacOS/prism\n\
                  11 /Volumes/Prism 1/Prism.app/Contents/MacOS/prism -psn_0_1\n\
                  12 /Applications/Prism.app/Contents/MacOS/prism --mcp-bridge http://x\n\
                  13 /bin/zsh -c /Applications/Prism.app/Contents/MacOS/prism\n\
                  14 /w/target/debug/prism\n\
                  15 /Applications/Prism.app/Contents/MacOS/prism-helper\n\
                  99 /Applications/Prism.app/Contents/MacOS/prism\n";
        assert_eq!(
            parse_ps(ps, 99),
            vec![(10, PathBuf::from("/Applications/Prism.app")), (11, PathBuf::from("/Volumes/Prism 1/Prism.app"))]
        );
    }

    fn fake_app(at: &Path, id: &str, version: &str) {
        std::fs::create_dir_all(at.join("Contents")).unwrap();
        let plist = format!("<dict>\n\t<key>CFBundleIdentifier</key>\n\t<string>{id}</string>\n\t<key>CFBundleShortVersionString</key>\n\t<string>{version}</string>\n</dict>");
        std::fs::write(at.join("Contents/Info.plist"), plist).unwrap();
    }

    #[test]
    fn reads_the_version_of_prism_bundles_only() {
        let dir = std::env::temp_dir().join(format!("prism-plist-{}", uuid::Uuid::new_v4()));
        fake_app(&dir.join("Prism.app"), BUNDLE_ID, "0.3.7");
        fake_app(&dir.join("Other.app"), "com.example.prism", "9.9.9");
        assert_eq!(bundle_version(&dir.join("Prism.app")), Some("0.3.7".into()));
        assert_eq!(bundle_version(&dir.join("Other.app")), None);
        assert_eq!(bundle_version(&dir.join("Missing.app")), None);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn moving_replaces_the_old_app_and_keeps_it_in_the_trash() {
        let dir = std::env::temp_dir().join(format!("prism-move-{}", uuid::Uuid::new_v4()));
        let (source, target, trash) = (dir.join("dl/Prism.app"), dir.join("apps/Prism.app"), dir.join("trash"));
        fake_app(&source, BUNDLE_ID, "0.3.9");
        fake_app(&target, BUNDLE_ID, "0.3.7");
        install_copy(&source, &target, &trash).unwrap();
        assert_eq!(bundle_version(&target), Some("0.3.9".into()));
        let kept: Vec<_> = std::fs::read_dir(&trash).unwrap().map(|e| e.unwrap().path()).collect();
        assert_eq!(kept.len(), 1);
        assert_eq!(bundle_version(&kept[0]), Some("0.3.7".into()));
        // a source that can't be copied leaves what's installed alone
        assert!(install_copy(&dir.join("nothing.app"), &target, &trash).is_err());
        assert_eq!(bundle_version(&target), Some("0.3.9".into()));
        assert_eq!(std::fs::read_dir(dir.join("apps")).unwrap().count(), 1, "no half copy left behind");
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// A real process: replacing its program file on disk is noticed, and it can be closed.
    #[cfg(target_os = "macos")]
    #[test]
    fn notices_a_program_replaced_under_a_running_process_and_closes_it() {
        let dir = std::env::temp_dir().canonicalize().unwrap().join(format!("prism-run-{}", uuid::Uuid::new_v4()));
        let bundle = dir.join("Prism.app");
        fake_app(&bundle, BUNDLE_ID, "0.3.7");
        let exe = bundle.join("Contents/MacOS/prism");
        std::fs::create_dir_all(exe.parent().unwrap()).unwrap();
        // a copy of a system program may not run (its signature is tied to its place), so build one
        let src = dir.join("sleep.rs");
        std::fs::write(&src, "fn main() { std::thread::sleep(std::time::Duration::from_secs(60)) }").unwrap();
        assert!(Command::new("rustc").arg(&src).arg("-o").arg(&exe).status().unwrap().success());
        let mut child = Command::new(&exe).spawn().unwrap();
        let pid = child.id();
        std::thread::sleep(std::time::Duration::from_millis(500));
        let ps = output("/bin/ps", &["-xwwo", "pid=,command="]).unwrap();
        assert!(parse_ps(&ps, std::process::id()).contains(&(pid, bundle.clone())), "found in the real process list");
        assert!(running_inode(pid).is_some());
        assert!(same_program(pid, &bundle));
        let newer = dir.join("newer");
        std::fs::copy(&exe, &newer).unwrap();
        std::fs::rename(&newer, &exe).unwrap();
        assert!(!same_program(pid, &bundle));
        // reaped on the side, as launchd would for a real app
        let reaper = std::thread::spawn(move || child.wait());
        close_processes(&[pid]).unwrap();
        assert!(!reaper.join().unwrap().unwrap().success());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
