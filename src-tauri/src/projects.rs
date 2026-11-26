//! Projects the user has added, and each project's team preset. Persisted as JSON.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::sys;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RoleConfig {
    pub agent: String,
    /// alias ("opus") or full id ("claude-opus-5-5")
    pub model: String,
    /// Claude Code --effort: "" (CLI default) | low | medium | high | xhigh | max
    #[serde(default)]
    pub effort: String,
    pub max: u32,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TeamConfig {
    /// "save" | "bal" | "power" | "custom"
    pub preset: String,
    pub lead: RoleConfig,
    pub managers: RoleConfig,
    pub workers: RoleConfig,
    pub concurrent: u32,
    /// Claude Code --permission-mode: "default" | "acceptEdits" | "bypassPermissions"
    pub permission_mode: String,
    /// Give managers/workers their own git worktree + branch.
    pub isolate: bool,
    /// Work in a copy of the project on its own branch and touch the original folder only when the
    /// user presses "결과 반영하기". Off: work (and merge) right in the original folder.
    #[serde(default = "yes")]
    pub safe: bool,
    /// The 총괄 merges finished work into the team branch by itself (asking only on a clash or a
    /// failing check). Off: the user presses 합치기 on each report.
    #[serde(default = "yes")]
    pub auto_merge: bool,
}

fn yes() -> bool {
    true
}

impl Default for TeamConfig {
    fn default() -> Self {
        let [l, m, w] = presets("bal").unwrap();
        let r = |(model, effort): (&str, &str), max| RoleConfig { agent: "claude".into(), model: model.into(), effort: effort.into(), max };
        Self {
            preset: "bal".into(),
            lead: r(l, 1),
            managers: r(m, 2),
            workers: r(w, 4),
            concurrent: 6,
            permission_mode: "acceptEdits".into(),
            isolate: true,
            safe: true,
            auto_merge: true,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_git: bool,
    #[serde(default)]
    pub team: TeamConfig,
    #[serde(default)]
    pub last_opened: u64,
    /// what every AI on this team should know (server info, conventions…), user-edited
    #[serde(default)]
    pub knowledge: String,
    /// brought in from outside the workspace folder ("다른 위치의 폴더 가져오기")
    #[serde(default)]
    pub linked: bool,
}

pub struct Projects {
    list: Mutex<Vec<Project>>,
    file: Mutex<Option<PathBuf>>,
    /// Workspace folder: every subfolder is a project.
    root: Mutex<PathBuf>,
    settings: Option<PathBuf>,
    prefs: Mutex<Settings>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    root: Option<String>,
    /// subscriptions the user chose at first run: "claude" | "codex"
    #[serde(default)]
    pub providers: Vec<String>,
    /// first-run guide finished
    #[serde(default)]
    pub onboarded: bool,
    /// teams that were clocked in when the app last closed (project ids)
    #[serde(default)]
    pub last_teams: Vec<String>,
    /// clock the teams of last time back in when the app starts
    #[serde(default = "yes")]
    pub auto_resume: bool,
    /// the app closed with teams at work: "update" (restarted to update — those teams come back
    /// no matter `auto_resume`) | "quit". Cleared once the start-up clock-in is done.
    #[serde(default)]
    pub restart: Option<String>,
    /// ask before closing the window or quitting while members are at work
    #[serde(default = "yes")]
    pub confirm_quit: bool,
    /// 사용자 허락이 필요하면 데스크톱 알림을 띄운다
    #[serde(default = "yes")]
    pub ask_alert: bool,
    /// 일이 끝나거나(합치기 포함) 실패·막히면 데스크톱 알림을 띄운다
    #[serde(default = "yes")]
    pub work_alert: bool,
    /// 처음 한 번의 안내 알림(macOS가 알림 허용을 묻게 하는 것)을 보냈는가
    #[serde(default)]
    pub alert_primed: bool,
    /// let members do safe things (reading, building, local commits…) without asking anyone
    #[serde(default = "yes")]
    pub auto_allow_safe: bool,
    /// 츄르 잔액 (토큰 1,000개당 1개씩 쌓인다)
    #[serde(default)]
    pub churu: u64,
    /// 가진 상점 물건 id 목록 ("cat:white"는 처음부터 가진다)
    #[serde(default = "default_owned")]
    pub owned: Vec<String>,
    /// 1,000토큰으로 환산되지 않고 남은 토큰 (다음에 더해서 환산한다)
    #[serde(default)]
    pub churu_rest: u64,
}

fn default_owned() -> Vec<String> {
    vec!["cat:white".into()]
}

/// 토큰 25,000개당 츄르 1개. 토큰 = input + output + cache_write (cache_read는 뺀다).
/// 이 컴퓨터 최근 4주 주간 평균 약 2,990만 토큰(입력+출력+캐시생성, 캐시읽기 제외)
/// → 4주 약 1억 1,960만 토큰 ≈ 상점 전체 합계 약 4,800츄르가 되도록 정함.
pub const TOKENS_PER_CHURU: u64 = 25_000;

impl Default for Settings {
    fn default() -> Self {
        Self {
            root: None,
            providers: Vec::new(),
            onboarded: false,
            last_teams: Vec::new(),
            auto_resume: true,
            restart: None,
            confirm_quit: true,
            ask_alert: true,
            work_alert: true,
            alert_primed: false,
            auto_allow_safe: true,
            churu: 0,
            owned: default_owned(),
            churu_rest: 0,
        }
    }
}

/// 토큰 `tokens`를 더해 (츄르 잔액, 남은 토큰)을 구한다. 환율 미만은 나머지로 이월된다.
pub fn churu_add(churu: u64, rest: u64, tokens: u64) -> (u64, u64) {
    let total = rest.saturating_add(tokens);
    (churu.saturating_add(total / TOKENS_PER_CHURU), total % TOKENS_PER_CHURU)
}

/// 휴게실 소품 가격 (츄르). 앱이 가격을 믿지 않도록 이 표가 기준이다.
/// 화면의 가격표(src/lib/shop.ts)와 같아야 한다: scripts/test/shop-prices.test.mjs 가 맞는지 본다.
pub const ITEM_PRICES: &[(&str, u64)] = &[
    ("소파", 150),
    ("책장", 100),
    ("액자", 30),
    ("스탠드", 60),
    ("햇살 자리", 40),
    ("숨숨집", 80),
    ("스크래처", 70),
    ("털실", 20),
    ("밥그릇", 20),
    ("러그", 50),
    ("러그·쿠션", 30),
    ("화분", 60),
    ("정수기", 120),
    ("캣타워", 100),
];

/// 소품 가격. "item:<이름>" 이 아니거나 없는 물건이면 None.
pub fn item_price(id: &str) -> Option<u64> {
    let name = id.strip_prefix("item:")?;
    ITEM_PRICES.iter().find(|(n, _)| *n == name).map(|(_, p)| *p)
}

/// 상점 물건을 산다 (가격은 `item_price`). 고양이는 뽑기로만 얻으므로 "cat:"은 거절한다.
/// 이미 가졌거나 잔액이 모자라면 Err (차감·추가 없음).
pub fn buy_item(s: &mut Settings, id: &str) -> Result<(), String> {
    if id.starts_with("cat:") {
        return Err("고양이는 뽑기로만 얻을 수 있어요".into());
    }
    let price = item_price(id).ok_or("없는 물건이에요")?;
    if s.owned.iter().any(|x| x == id) {
        return Err("이미 가지고 있는 물건이에요".into());
    }
    if s.churu < price {
        return Err(format!("츄르가 {}개 모자라요 (필요 {}개, 있는 츄르 {}개)", price - s.churu, price, s.churu));
    }
    s.churu -= price;
    s.owned.push(id.into());
    Ok(())
}

// ── 고양이 뽑기 ──

/// 뽑기 1회 가격 (츄르). 환급은 없다: 이미 가진 고양이가 나와도 같은 가격을 낸다.
pub const GACHA_PRICE: u64 = 250;

/// 뽑기 대상 고양이 11종 (흰 고양이는 처음부터 가져서 뺀다). (id, 등급, 가중치), 가중치 합 300.
/// 흔함 36(12%) · 귀함 24(8%) · 아주 귀함 16(약 5.3%).
/// 근거: 한 달 약 4,780츄르 - 소품 930 = 3,850츄르 → 환급 없이 250씩 15번 뽑는다.
/// 모의 뽑기 6만 번: 11종 중 평균 약 8.1종 (중앙값 8, 93%가 7종 이상) → 흰 고양이 포함 약 9/12종.
pub const GACHA_CATS: &[(&str, &str, u32)] = &[
    ("grey", "흔함", 36),
    ("cream", "흔함", 36),
    ("ginger", "흔함", 36),
    ("bicolor", "흔함", 36),
    ("pink", "흔함", 36),
    ("silver", "귀함", 24),
    ("black", "귀함", 24),
    ("brown", "귀함", 24),
    ("calico", "아주 귀함", 16),
    ("tuxedo", "아주 귀함", 16),
    ("siamese", "아주 귀함", 16),
];

/// 뽑기 결과. `cat`은 "cat:<털색 id>", `is_new`는 처음 얻은 고양이인지.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GachaPulled {
    pub cat: String,
    pub is_new: bool,
    pub prefs: Settings,
}

/// 뽑기 1회 난수 `rand`(0..=u32::MAX)로 고양이 id를 고른다. 가중치대로, 치우침 없이 (범위 밖 값은 버리고 다시 뽑는다).
pub fn pick_cat(rand: &mut dyn FnMut() -> u32) -> &'static str {
    let total: u32 = GACHA_CATS.iter().map(|c| c.2).sum();
    let limit = u32::MAX - u32::MAX % total;
    let r = loop {
        let x = rand();
        if x < limit {
            break x % total;
        }
    };
    let mut acc = 0;
    for (id, _, w) in GACHA_CATS {
        acc += w;
        if r < acc {
            return id;
        }
    }
    GACHA_CATS[GACHA_CATS.len() - 1].0
}

/// 뽑기 한 번 (순수 계산): 모두 모았으면 Err, 잔액이 모자라면 Err (둘 다 차감·추가 없음).
/// 성공하면 250츄르를 빼고, 새 고양이면 owned에 더한다. 중복이어도 환급은 없다.
pub fn gacha_roll(s: &mut Settings, rand: &mut dyn FnMut() -> u32) -> Result<(String, bool), String> {
    let all = GACHA_CATS.iter().all(|(id, _, _)| s.owned.iter().any(|x| x == &format!("cat:{id}")));
    if all {
        return Err("고양이를 모두 모았어요. 더 뽑을 고양이가 없어요".into());
    }
    if s.churu < GACHA_PRICE {
        return Err(format!("츄르가 {}개 모자라요 (뽑기 {}츄르, 있는 츄르 {}개)", GACHA_PRICE - s.churu, GACHA_PRICE, s.churu));
    }
    let cat = format!("cat:{}", pick_cat(rand));
    s.churu -= GACHA_PRICE;
    let is_new = !s.owned.iter().any(|x| *x == cat);
    if is_new {
        s.owned.push(cat.clone());
    }
    Ok((cat, is_new))
}

/// 화면이 확률표를 그릴 때 쓰는 값. percent는 소수 첫째 자리까지 (5.3 등).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GachaCatInfo {
    pub id: &'static str,
    pub tier: &'static str,
    pub percent: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GachaInfo {
    pub price: u64,
    pub cats: Vec<GachaCatInfo>,
}

pub fn gacha_info_value() -> GachaInfo {
    let total: u32 = GACHA_CATS.iter().map(|c| c.2).sum();
    GachaInfo {
        price: GACHA_PRICE,
        cats: GACHA_CATS
            .iter()
            .map(|(id, tier, w)| GachaCatInfo { id, tier, percent: (*w as u64 * 1000 / total as u64) as f64 / 10.0 })
            .collect(),
    }
}

/// 난수 한 개 (uuid v4의 앞 4바이트). 뽑기 명령만 쓴다.
fn random_u32() -> u32 {
    let b = uuid::Uuid::new_v4();
    let a = b.as_bytes();
    u32::from_le_bytes([a[0], a[1], a[2], a[3]])
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

impl Projects {
    pub fn load(app: &AppHandle) -> Self {
        let file = app.path().app_data_dir().ok().map(|d| d.join("projects.json"));
        let list = file
            .as_ref()
            .and_then(|f| std::fs::read_to_string(f).ok())
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        let settings = app.path().app_data_dir().ok().map(|d| d.join("settings.json"));
        let saved: Settings = settings
            .as_ref()
            .and_then(|f| std::fs::read_to_string(f).ok())
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        let prefs = saved.clone();
        let root = saved
            .root
            .map(PathBuf::from)
            .or_else(|| app.path().home_dir().ok().map(|h| h.join("Prism")))
            .unwrap_or_else(|| PathBuf::from("Prism"));
        let _ = std::fs::create_dir_all(&root);
        let mut list: Vec<Project> = list;
        // agents that are no longer supported fall back to Claude
        for p in &mut list {
            for r in [&mut p.team.lead, &mut p.team.managers, &mut p.team.workers] {
                if !crate::accounts::PROVIDERS.contains(&r.agent.as_str()) {
                    r.agent = "claude".into();
                    r.model = "sonnet".into();
                }
            }
        }
        Self { list: Mutex::new(list), file: Mutex::new(file), root: Mutex::new(root), settings, prefs: Mutex::new(prefs) }
    }

    /// Ask before closing or quitting while members are at work (the "정말 끌까요?" question).
    pub fn confirm_quit(&self) -> bool {
        self.prefs.lock().unwrap().confirm_quit
    }

    pub fn settings(&self) -> Settings {
        self.prefs.lock().unwrap().clone()
    }

    /// Turns one desktop alert on or off: the permission one (`ask`) or the finished-work one.
    pub fn set_alert(&self, ask: bool, on: bool) -> Settings {
        {
            let mut p = self.prefs.lock().unwrap();
            if ask {
                p.ask_alert = on;
            } else {
                p.work_alert = on;
            }
        }
        self.save_prefs();
        self.settings()
    }

    /// True once: some alert is on and the introduction hasn't been sent yet (marked as sent here).
    pub fn take_alert_priming(&self) -> bool {
        {
            let mut p = self.prefs.lock().unwrap();
            if !(p.ask_alert || p.work_alert) || p.alert_primed {
                return false;
            }
            p.alert_primed = true;
        }
        self.save_prefs();
        true
    }

    /// "안전한 일은 자동 허락"
    pub fn auto_allow_safe(&self) -> bool {
        self.prefs.lock().unwrap().auto_allow_safe
    }

    /// Remember which teams are clocked in (for "지난번 팀 다시 출근").
    pub fn set_last_teams(&self, ids: Vec<String>) {
        {
            let mut p = self.prefs.lock().unwrap();
            if p.last_teams == ids {
                return;
            }
            p.last_teams = ids;
        }
        self.save_prefs();
    }

    /// The app is going away (`why`: "update" | "quit") with these teams clocked in: remember them,
    /// and why, in one write.
    pub fn set_closing(&self, live: Vec<String>, why: &str) {
        {
            let mut p = self.prefs.lock().unwrap();
            p.restart = (!live.is_empty()).then(|| why.to_string());
            p.last_teams = live;
        }
        self.save_prefs();
    }

    /// 새로 쓴 토큰을 츄르로 쌓는다. 츄르가 바뀌었으면 저장하고 새 Settings를 돌려준다.
    pub fn add_churu_tokens(&self, tokens: u64) -> Option<Settings> {
        if tokens == 0 {
            return None;
        }
        let snap = {
            let mut p = self.prefs.lock().unwrap();
            let (churu, rest) = churu_add(p.churu, p.churu_rest, tokens);
            p.churu = churu;
            p.churu_rest = rest;
            p.clone()
        };
        self.save_prefs();
        Some(snap)
    }

    /// 상점에서 소품을 산다 (`buy_item`). 성공하면 저장하고 새 Settings를 돌려준다.
    pub fn buy(&self, id: &str) -> Result<Settings, String> {
        let snap = {
            let mut p = self.prefs.lock().unwrap();
            buy_item(&mut p, id)?;
            p.clone()
        };
        self.save_prefs();
        Ok(snap)
    }

    /// 고양이 뽑기 한 번. 계산·차감·추가·저장을 한 잠금 안에서 하고, 결과를 돌려준다.
    pub fn gacha(&self, rand: &mut dyn FnMut() -> u32) -> Result<GachaPulled, String> {
        let (cat, is_new, snap) = {
            let mut p = self.prefs.lock().unwrap();
            let (cat, is_new) = gacha_roll(&mut p, rand)?;
            (cat, is_new, p.clone())
        };
        self.save_prefs();
        Ok(GachaPulled { cat, is_new, prefs: snap })
    }

    fn save_prefs(&self) {
        if let Some(f) = &self.settings {
            let mut p = self.prefs.lock().unwrap().clone();
            p.root = Some(self.root.lock().unwrap().to_string_lossy().into_owned());
            let _ = std::fs::create_dir_all(f.parent().unwrap());
            let _ = std::fs::write(f, serde_json::to_string_pretty(&p).unwrap_or_default());
        }
    }

    /// Team for a new project, shaped by the subscriptions the user has.
    /// Remember a subscription as one the user uses (signed in, or picked).
    pub fn add_provider(&self, provider: &str) {
        let added = {
            let mut p = self.prefs.lock().unwrap();
            let new = !p.providers.iter().any(|x| x == provider);
            if new {
                p.providers.push(provider.into());
            }
            new
        };
        if added {
            self.save_prefs();
        }
    }

    /// New teams run on Claude when it's among the user's subscriptions; otherwise on the one
    /// they have (Gemini-only or ChatGPT-only).
    fn default_team(&self) -> TeamConfig {
        let providers = self.prefs.lock().unwrap().providers.clone();
        let mut t = TeamConfig::default();
        if providers.iter().any(|p| p == "claude") {
            return t;
        }
        if providers.iter().any(|p| p == "antigravity") && !providers.iter().any(|p| p == "codex") {
            // Google-only: the whole team runs on Antigravity (its default model)
            for r in [&mut t.lead, &mut t.managers, &mut t.workers] {
                r.agent = "antigravity".into();
                r.model = String::new();
                r.effort = String::new();
            }
            t.preset = "custom".into();
        } else if providers.iter().any(|p| p == "codex") {
            // ChatGPT-only: the whole team runs on Codex
            let model = crate::launch::models_for("codex", None).into_iter().next().map(|m| m.id).unwrap_or_default();
            for r in [&mut t.lead, &mut t.managers, &mut t.workers] {
                r.agent = "codex".into();
                r.model = model.clone();
                r.effort = "medium".into();
            }
            t.lead.effort = "high".into();
            t.preset = "custom".into();
        }
        t
    }

    /// Projects = the workspace root's subfolders; keeps each folder's saved team config.
    fn sync(&self) -> Vec<Project> {
        let root = self.root.lock().unwrap().clone();
        let mut list = self.list.lock().unwrap();
        let mut dirs: Vec<PathBuf> = std::fs::read_dir(&root)
            .map(|rd| rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_dir()).collect())
            .unwrap_or_default();
        dirs.retain(|d| d.file_name().map(|n| !n.to_string_lossy().starts_with('.')).unwrap_or(false));
        let mut changed = false;
        let mut out = vec![];
        for dir in dirs {
            let path = dir.to_string_lossy().into_owned();
            let is_git = dir.join(".git").exists();
            let p = match list.iter_mut().find(|p| p.path == path) {
                Some(p) => {
                    if p.is_git != is_git {
                        p.is_git = is_git;
                        changed = true;
                    }
                    p.clone()
                }
                None => {
                    let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                    let p = Project { id: uuid::Uuid::new_v4().to_string()[..8].to_string(), name, path, is_git, team: self.default_team(), last_opened: 0, knowledge: String::new(), linked: false };
                    list.push(p.clone());
                    changed = true;
                    p
                }
            };
            out.push(p);
        }
        // folders brought in from elsewhere, while they still exist
        for p in list.iter().filter(|p| p.linked && std::path::Path::new(&p.path).is_dir()) {
            if !out.iter().any(|o| o.path == p.path) {
                out.push(p.clone());
            }
        }
        if changed {
            self.save(&list);
        }
        out.sort_by(|a, b| b.last_opened.cmp(&a.last_opened).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        out
    }

    pub fn mark_git(&self, id: &str) {
        let _ = self.update(id, |p| p.is_git = true);
    }

    fn save(&self, list: &[Project]) {
        if let Some(f) = self.file.lock().unwrap().as_ref() {
            let _ = std::fs::create_dir_all(f.parent().unwrap());
            if let Ok(text) = serde_json::to_string_pretty(list) {
                let tmp = f.with_extension("json.tmp");
                if std::fs::write(&tmp, text).is_ok() {
                    let _ = std::fs::rename(tmp, f);
                }
            }
        }
    }

    pub fn get(&self, id: &str) -> Option<Project> {
        self.list.lock().unwrap().iter().find(|p| p.id == id).cloned()
    }

    fn update(&self, id: &str, f: impl FnOnce(&mut Project)) -> Result<Project, String> {
        let mut list = self.list.lock().unwrap();
        let p = list.iter_mut().find(|p| p.id == id).ok_or("no such project")?;
        f(p);
        let out = p.clone();
        self.save(&list);
        Ok(out)
    }
}

/// (model, effort) for [lead, managers, workers]
pub fn presets(name: &str) -> Option<[(&'static str, &'static str); 3]> {
    match name {
        "save" => Some([("sonnet", "medium"), ("haiku", "low"), ("haiku", "low")]),
        "bal" => Some([("opus", "high"), ("sonnet", "medium"), ("haiku", "medium")]),
        "power" => Some([("opus", "xhigh"), ("opus", "high"), ("sonnet", "high")]),
        _ => None,
    }
}

#[tauri::command]
pub fn projects_list(projects: State<'_, Projects>) -> Vec<Project> {
    projects.sync()
}

#[tauri::command]
pub fn workspace_root(projects: State<'_, Projects>) -> String {
    projects.root.lock().unwrap().to_string_lossy().into_owned()
}

#[tauri::command]
pub fn workspace_set_root(projects: State<'_, Projects>, path: String) -> Result<Vec<Project>, String> {
    let dir = PathBuf::from(&path);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    *projects.root.lock().unwrap() = dir;
    let _ = path;
    projects.save_prefs();
    Ok(projects.sync())
}

/// New project = new folder in the workspace with a git repo and a first commit.
#[tauri::command]
pub fn project_create(projects: State<'_, Projects>, name: String) -> Result<Project, String> {
    let name = name.trim();
    if name.is_empty() || name.starts_with('.') || name.contains(['/', '\\', ':']) {
        return Err("폴더 이름으로 쓸 수 없는 이름이에요".into());
    }
    let dir = projects.root.lock().unwrap().join(name);
    if dir.exists() {
        return Err("같은 이름의 프로젝트가 이미 있어요".into());
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    sys::ensure_repo(&dir.to_string_lossy())?;
    let path = dir.to_string_lossy().into_owned();
    projects.sync();
    let p = projects.list.lock().unwrap().iter().find(|p| p.path == path).cloned().ok_or("생성 실패")?;
    projects.update(&p.id, |p| p.last_opened = now_ms())
}

/// "다른 위치의 폴더 가져오기": make a project of a folder outside the workspace. Nothing in the
/// folder changes now (a folder without git gets one when its team first clocks in).
#[tauri::command]
pub fn project_import(projects: State<'_, Projects>, path: String) -> Result<Project, String> {
    let dir = PathBuf::from(path.trim());
    if !dir.is_dir() {
        return Err("폴더를 찾을 수 없어요".into());
    }
    let dir = std::fs::canonicalize(&dir).unwrap_or(dir);
    let path = dir.to_string_lossy().into_owned();
    if let Some(home) = std::env::home_dir() {
        if dir == home || dir.parent().is_none() {
            return Err("홈 폴더나 디스크 전체는 프로젝트로 가져올 수 없어요. 프로젝트 폴더를 골라주세요.".into());
        }
    }
    let existing = projects.sync().into_iter().find(|p| p.path == path);
    if let Some(p) = existing {
        return projects.update(&p.id, |p| p.last_opened = now_ms());
    }
    let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "프로젝트".into());
    let p = Project {
        id: uuid::Uuid::new_v4().to_string()[..8].to_string(),
        name,
        is_git: dir.join(".git").exists(),
        path,
        team: projects.default_team(),
        last_opened: now_ms(),
        knowledge: String::new(),
        linked: true,
    };
    {
        let mut list = projects.list.lock().unwrap();
        list.push(p.clone());
        projects.save(&list);
    }
    Ok(p)
}

/// Take a brought-in folder off the list. The folder itself is left as it is.
#[tauri::command]
pub fn project_forget(projects: State<'_, Projects>, id: String) -> Result<(), String> {
    let mut list = projects.list.lock().unwrap();
    let p = list.iter().find(|p| p.id == id).ok_or("그런 프로젝트가 없어요")?;
    if !p.linked {
        return Err("작업 폴더 안의 프로젝트는 목록에서 뺄 수 없어요".into());
    }
    list.retain(|p| p.id != id);
    projects.save(&list);
    Ok(())
}

#[tauri::command]
pub fn prefs_get(projects: State<'_, Projects>) -> Settings {
    projects.prefs.lock().unwrap().clone()
}

#[tauri::command]
pub fn prefs_set(projects: State<'_, Projects>, providers: Vec<String>, onboarded: bool) -> Settings {
    {
        let mut p = projects.prefs.lock().unwrap();
        p.providers = providers.into_iter().filter(|x| crate::accounts::PROVIDERS.contains(&x.as_str())).collect();
        p.onboarded = onboarded;
    }
    projects.save_prefs();
    projects.prefs.lock().unwrap().clone()
}

#[tauri::command]
pub fn prefs_set_auto_resume(projects: State<'_, Projects>, on: bool) -> Settings {
    projects.prefs.lock().unwrap().auto_resume = on;
    projects.save_prefs();
    projects.prefs.lock().unwrap().clone()
}

#[tauri::command]
pub fn prefs_set_auto_allow_safe(projects: State<'_, Projects>, on: bool) -> Settings {
    projects.prefs.lock().unwrap().auto_allow_safe = on;
    projects.save_prefs();
    projects.prefs.lock().unwrap().clone()
}

#[tauri::command]
pub fn prefs_set_confirm_quit(projects: State<'_, Projects>, on: bool) -> Settings {
    projects.prefs.lock().unwrap().confirm_quit = on;
    projects.save_prefs();
    projects.prefs.lock().unwrap().clone()
}

/// The start-up clock-in after a restart is done: forget why the app last closed.
/// 상점에서 소품을 산다. 가격은 Rust 표(`ITEM_PRICES`)로 정한다. 고양이("cat:")는 거절. 츄르가 모자라거나 이미 가졌으면 Err.
#[tauri::command]
pub fn shop_buy(app: AppHandle, projects: State<'_, Projects>, id: String) -> Result<Settings, String> {
    let s = projects.buy(&id)?;
    let _ = app.emit("prefs", &s);
    Ok(s)
}

/// 고양이 뽑기 1회 (인자 없음). 결과와 저장된 Settings를 돌려주고 "prefs" 이벤트를 보낸다.
#[tauri::command]
pub fn gacha_pull(app: AppHandle, projects: State<'_, Projects>) -> Result<GachaPulled, String> {
    let r = projects.gacha(&mut random_u32)?;
    let _ = app.emit("prefs", &r.prefs);
    Ok(r)
}

/// 뽑기 가격과 고양이별 등급·확률 (화면 확률표용)
#[tauri::command]
pub fn gacha_info() -> GachaInfo {
    gacha_info_value()
}

#[tauri::command]
pub fn prefs_clear_restart(projects: State<'_, Projects>) -> Settings {
    projects.prefs.lock().unwrap().restart = None;
    projects.save_prefs();
    projects.prefs.lock().unwrap().clone()
}

#[tauri::command]
pub fn project_touch(projects: State<'_, Projects>, id: String) -> Result<Project, String> {
    projects.update(&id, |p| p.last_opened = now_ms())
}

#[tauri::command]
pub fn project_set_team(projects: State<'_, Projects>, id: String, team: TeamConfig) -> Result<Project, String> {
    projects.update(&id, |p| p.team = team)
}

#[tauri::command]
pub fn project_set_knowledge(projects: State<'_, Projects>, id: String, text: String) -> Result<Project, String> {
    projects.update(&id, |p| p.knowledge = text)
}

// ── shared knowledge: what every AI on every team should know ──

fn knowledge_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("knowledge.md"))
}

pub fn shared_knowledge(app: &AppHandle) -> String {
    knowledge_file(app).and_then(|f| std::fs::read_to_string(f).ok()).unwrap_or_default()
}

#[tauri::command]
pub fn knowledge_get(app: AppHandle) -> String {
    shared_knowledge(&app)
}

#[tauri::command]
pub fn knowledge_set(app: AppHandle, text: String) -> Result<(), String> {
    let f = knowledge_file(&app).ok_or("저장할 곳을 찾지 못했어요")?;
    let _ = std::fs::create_dir_all(f.parent().unwrap());
    std::fs::write(f, text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn project_set_preset(projects: State<'_, Projects>, id: String, preset: String) -> Result<Project, String> {
    let models = presets(&preset).ok_or("unknown preset")?;
    projects.update(&id, |p| {
        p.team.preset = preset;
        // the preset's models are Claude's: a role on Gemini or Codex keeps its program's default
        for (role, (model, effort)) in [&mut p.team.lead, &mut p.team.managers, &mut p.team.workers].into_iter().zip(models) {
            if role.agent == "claude" {
                role.model = model.into();
                role.effort = effort.into();
            } else if crate::launch::is_claude_model(&role.model) {
                role.model = String::new();
            }
        }
    })
}

#[tauri::command]
pub fn worktrees_list(path: String) -> Vec<sys::WorktreeInfo> {
    sys::worktrees(&path)
}

#[tauri::command]
pub fn git_changes(cwd: String) -> Vec<sys::Change> {
    sys::changes(&cwd)
}

#[tauri::command]
pub fn git_diff(cwd: String, path: String) -> String {
    sys::diff(&cwd, &path)
}

#[cfg(test)]
mod churu_tests {
    use super::*;

    fn fresh() -> Settings {
        Settings::default()
    }

    #[test]
    fn rest_below_rate_carries_over() {
        // 환율 미만은 츄르로 안 바뀌고 나머지로 이월된다
        assert_eq!(churu_add(0, 0, TOKENS_PER_CHURU - 1), (0, TOKENS_PER_CHURU - 1));
        // 이월된 나머지에 더해져 한 츄르가 된다
        assert_eq!(churu_add(0, TOKENS_PER_CHURU - 1, 1), (1, 0));
        assert_eq!(churu_add(3, 10, TOKENS_PER_CHURU * 2 + 5), (5, 15));
    }

    #[test]
    fn buy_fails_when_short_and_changes_nothing() {
        let mut s = fresh();
        s.churu = 4;
        let err = buy_item(&mut s, "item:소파").unwrap_err();
        assert!(err.contains("146개 모자라요"));
        assert_eq!(s.churu, 4);
        assert_eq!(s.owned, vec!["cat:white".to_string()]);
    }

    #[test]
    fn buy_deducts_item_price_and_adds_owned() {
        let mut s = fresh();
        s.churu = 200;
        buy_item(&mut s, "item:소파").unwrap();
        assert_eq!(s.churu, 50);
        assert!(s.owned.iter().any(|x| x == "item:소파"));
    }

    #[test]
    fn buy_twice_is_rejected_without_charging() {
        let mut s = fresh();
        s.churu = 300;
        buy_item(&mut s, "item:소파").unwrap();
        let err = buy_item(&mut s, "item:소파").unwrap_err();
        assert!(err.contains("이미"));
        assert_eq!(s.churu, 150);
        assert_eq!(s.owned.iter().filter(|x| *x == "item:소파").count(), 1);
    }

    #[test]
    fn shop_buy_rejects_cats() {
        // 고양이는 뽑기로만 얻는다: 어떤 털색이든 상점 구매는 거절, 잔액도 물건도 그대로
        let mut s = fresh();
        s.churu = 99_999;
        let err = buy_item(&mut s, "cat:black").unwrap_err();
        assert!(err.contains("뽑기"));
        assert_eq!(s.churu, 99_999);
        assert_eq!(s.owned, vec!["cat:white".to_string()]);
    }

    #[test]
    fn unknown_item_is_rejected() {
        let mut s = fresh();
        s.churu = 99_999;
        assert!(buy_item(&mut s, "item:없는것").is_err());
        assert!(buy_item(&mut s, "소파").is_err());
        assert_eq!(s.churu, 99_999);
    }

    #[test]
    fn gacha_weights_sum_to_300_with_eleven_cats() {
        let total: u32 = GACHA_CATS.iter().map(|c| c.2).sum();
        assert_eq!(total, 300);
        assert_eq!(GACHA_CATS.len(), 11);
        // white(기본 보유)은 뽑기 대상이 아니다
        assert!(GACHA_CATS.iter().all(|c| c.0 != "white"));
        assert_eq!(GACHA_PRICE, 250);
    }

    #[test]
    fn pick_boundaries_follow_weights() {
        assert_eq!(pick_cat(&mut || 0), "grey");
        assert_eq!(pick_cat(&mut || 35), "grey");
        assert_eq!(pick_cat(&mut || 36), "cream");
        assert_eq!(pick_cat(&mut || 179), "pink"); // 36×5 = 180 미만이면 흔함
        assert_eq!(pick_cat(&mut || 180), "silver");
        assert_eq!(pick_cat(&mut || 299), "siamese");
    }

    #[test]
    fn pick_skips_values_outside_even_range() {
        // u32::MAX 근처 값은 300으로 똑같이 나눠지지 않아 버리고 다시 뽑는다 (치우침 방지)
        let mut seq = vec![u32::MAX, u32::MAX - 1, 7].into_iter();
        assert_eq!(pick_cat(&mut || seq.next().unwrap()), "grey");
    }

    #[test]
    fn gacha_new_cat_charges_price_and_adds_owned() {
        let mut s = fresh();
        s.churu = 300;
        let (cat, is_new) = gacha_roll(&mut s, &mut || 0).unwrap();
        assert_eq!(cat, "cat:grey");
        assert!(is_new);
        assert_eq!(s.churu, 50);
        assert!(s.owned.iter().any(|x| x == "cat:grey"));
    }

    #[test]
    fn gacha_duplicate_is_charged_full_price_without_refund() {
        // 중복이면 환급 없이 뽑기 가격 250만 빠진다. owned는 그대로
        let mut s = fresh();
        s.churu = 300;
        s.owned.push("cat:grey".into());
        let before = s.owned.clone();
        let (cat, is_new) = gacha_roll(&mut s, &mut || 0).unwrap();
        assert_eq!(cat, "cat:grey");
        assert!(!is_new);
        assert_eq!(s.churu, 50);
        assert_eq!(s.owned, before);
    }

    #[test]
    fn gacha_short_balance_changes_nothing() {
        let mut s = fresh();
        s.churu = 249;
        let err = gacha_roll(&mut s, &mut || 0).unwrap_err();
        assert!(err.contains("1개 모자라요"));
        assert_eq!(s.churu, 249);
        assert_eq!(s.owned, vec!["cat:white".to_string()]);
    }

    #[test]
    fn gacha_all_collected_is_refused_without_charge() {
        let mut s = fresh();
        s.churu = 10_000;
        for (id, _, _) in GACHA_CATS {
            s.owned.push(format!("cat:{id}"));
        }
        let err = gacha_roll(&mut s, &mut || 0).unwrap_err();
        assert!(err.contains("모두 모았어요"));
        assert_eq!(s.churu, 10_000);
        assert_eq!(s.owned.len(), 12);
    }

    #[test]
    fn gacha_info_lists_eleven_cats_with_percent() {
        let info = gacha_info_value();
        assert_eq!(info.price, 250);
        assert_eq!(info.cats.len(), 11);
        let grey = info.cats.iter().find(|c| c.id == "grey").unwrap();
        assert_eq!((grey.tier, grey.percent), ("흔함", 12.0));
        let siamese = info.cats.iter().find(|c| c.id == "siamese").unwrap();
        assert_eq!((siamese.tier, siamese.percent), ("아주 귀함", 5.3));
    }

    #[test]
    fn item_prices_are_known_and_positive() {
        assert_eq!(item_price("item:소파"), Some(150));
        assert_eq!(item_price("item:없는것"), None);
        assert_eq!(item_price("cat:grey"), None);
        assert!(ITEM_PRICES.iter().all(|(_, p)| *p > 0));
    }

    #[test]
    fn owned_default_is_white_cat_even_when_file_is_old() {
        // 옛 settings.json(츄르 필드 없음)도 깨지지 않고 기본값으로 읽힌다
        let s: Settings = serde_json::from_str("{}").unwrap();
        assert_eq!(s.churu, 0);
        assert_eq!(s.churu_rest, 0);
        assert_eq!(s.owned, vec!["cat:white".to_string()]);
        let v = serde_json::to_value(&s).unwrap();
        assert!(v.get("churuRest").is_some());
    }
}
