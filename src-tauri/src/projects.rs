//! Projects the user has added, and each project's team preset. Persisted as JSON.

use std::collections::BTreeMap;
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
    /// failing check). Off: the user presses 적용하기 on each report.
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
    /// 일이 끝나거나(적용 포함) 실패·막히면 데스크톱 알림을 띄운다
    #[serde(default = "yes")]
    pub work_alert: bool,
    /// 처음 한 번의 안내 알림(macOS가 알림 허용을 묻게 하는 것)을 보냈는가
    #[serde(default)]
    pub alert_primed: bool,
    /// let members do safe things (reading, building, local commits…) without asking anyone
    #[serde(default = "yes")]
    pub auto_allow_safe: bool,
    /// 츄르 잔액 (토큰 TOKENS_PER_CHURU개당 1개씩 쌓인다)
    #[serde(default)]
    pub churu: u64,
    /// 가진 상점 물건 id 목록 ("cat:white"는 처음부터 가진다)
    #[serde(default = "default_owned")]
    pub owned: Vec<String>,
    /// 사용자가 고른 팀원 털색: "<프로젝트 id>:<직책>:<팀원 이름>" → 털색 id. 없으면 화면이 이름으로 자동 배정한다
    #[serde(default)]
    pub coats: BTreeMap<String, String>,
    /// 사용자가 지어 준 고양이 이름. 키는 `coats`와 같다. 없으면 화면의 원래 이름
    #[serde(default)]
    pub cat_names: BTreeMap<String, String>,
    /// 츄르 1개로 환산되지 않고 남은 토큰 (다음에 더해서 환산한다)
    #[serde(default)]
    pub churu_rest: u64,
    /// 토큰 말고 츄르를 받은 기록 (같은 보상을 두 번 주지 않으려고 날짜·카드를 적어 둔다)
    #[serde(default)]
    pub rewards: RewardLog,
}

/// 보상 지급 기록. 날짜(`*_day`)는 이 컴퓨터의 현지 날짜를 하루 단위 번호로 적은 것 (`today`). 0이면 받은 적 없음.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RewardLog {
    /// 마지막으로 출석 보상을 받은 날
    pub attend_day: i32,
    /// 연속 출석 일수 (`attend_day`까지)
    pub streak: u32,
    /// `card_count`를 센 날
    pub card_day: i32,
    pub card_count: u32,
    /// 이미 계산한 작업 카드 (`card_key`), 오래된 것부터. 최근 `PAID_CARDS_KEPT`개만 남긴다.
    pub paid_cards: Vec<String>,
    /// `pet_count`를 센 날
    pub pet_day: i32,
    pub pet_count: u32,
    /// 이미 받은 선물 ID (`Gift::id`). 지우지 않는다.
    pub gifts: Vec<String>,
}

fn default_owned() -> Vec<String> {
    vec!["cat:white".into()]
}

/// 토큰 12,500개당 츄르 1개. 토큰 = input + output + cache_write (cache_read는 뺀다).
/// 이 컴퓨터 최근 4주 주간 평균 약 2,990만 토큰(입력+출력+캐시생성, 캐시읽기 제외)
/// → 4주 약 1억 1,960만 토큰 ≈ 약 4,800츄르(25,000개당 1개)로 처음 정했고, 이후 받는 양을 2배(약 9,600츄르)로 늘림.
pub const TOKENS_PER_CHURU: u64 = 12_500;

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
            coats: BTreeMap::new(),
            cat_names: BTreeMap::new(),
            churu_rest: 0,
            rewards: RewardLog::default(),
        }
    }
}

/// 팀원 `member`의 털색을 정한다. `coat`가 None이면 자동 배정으로 되돌린다. 가진 털색(owned의 "cat:<id>")만 고를 수 있다.
pub fn set_coat(s: &mut Settings, member: &str, coat: Option<&str>) -> Result<(), String> {
    if member.is_empty() {
        return Err("어느 팀원인지 알 수 없어요".into());
    }
    match coat {
        None => {
            s.coats.remove(member);
        }
        Some(c) => {
            if !s.owned.iter().any(|x| x.strip_prefix("cat:") == Some(c)) {
                return Err("아직 없는 털색이에요. 상점에서 뽑으면 고를 수 있어요".into());
            }
            s.coats.insert(member.into(), c.into());
        }
    }
    Ok(())
}

/// 고양이 이름의 글자 수 상한. 화면(coats.ts `CAT_NAME_MAX`)과 같아야 한다.
pub const CAT_NAME_MAX: usize = 12;

/// 팀원 `member`의 고양이 이름을 정한다 (앞뒤 빈칸은 뺀다). `name`이 None이면 원래 이름으로 되돌린다.
pub fn set_cat_name(s: &mut Settings, member: &str, name: Option<&str>) -> Result<(), String> {
    if member.is_empty() {
        return Err("어느 팀원인지 알 수 없어요".into());
    }
    match name.map(str::trim) {
        None => {
            s.cat_names.remove(member);
        }
        Some("") => return Err("이름을 한 글자 이상 적어 주세요".into()),
        Some(n) if n.chars().count() > CAT_NAME_MAX => return Err(format!("이름은 {CAT_NAME_MAX}자까지 지을 수 있어요")),
        Some(n) if n.chars().any(char::is_control) => return Err("이름에 쓸 수 없는 글자가 있어요".into()),
        Some(n) => {
            s.cat_names.insert(member.into(), n.into());
        }
    }
    Ok(())
}

/// 토큰 `tokens`를 더해 (츄르 잔액, 남은 토큰)을 구한다. 환율 미만은 나머지로 이월된다.
pub fn churu_add(churu: u64, rest: u64, tokens: u64) -> (u64, u64) {
    let total = rest.saturating_add(tokens);
    (churu.saturating_add(total / TOKENS_PER_CHURU), total % TOKENS_PER_CHURU)
}

// ── 토큰 말고 츄르를 받는 방법 ──
//
// 기준은 토큰 보상 4주 약 9,600츄르(`TOKENS_PER_CHURU`), 하루 평균 약 340츄르다.
// 아래 보상은 덤이어야 하므로(토큰 보상이 계속 주된 수입) 4주 합계를 그 1/3 아래로 잡았다.
//   · 출석: 20 → 하루 이어질 때마다 +2 (최대 30), 7일째마다 +50. 28일 개근 = 810 + 50×4 = 1,010 (약 11%)
//   · 작업 카드: 1장 6, 하루 10장까지. 하루 5장이면 840 (약 9%), 매일 상한을 채워도 1,680 (약 18%)
//   · 고양이: 1번 2, 하루 5번까지(10). 28일 280 (약 3%)
// 합계: 보통 약 2,130 (약 22%), 최대 2,970 (약 31%) → 4주에 뽑기(250) 약 8~11번 더.
// 화면의 안내 값(src/lib/shop.ts EARN)과 같아야 한다: scripts/test/shop-prices.test.mjs 가 맞는지 본다.

/// 출석 첫날 보상
pub const ATTEND_BASE: u64 = 20;
/// 연속 출석이 하루 늘 때마다 더 주는 양
pub const ATTEND_STEP: u64 = 2;
/// 연속 출석으로 더 주는 양의 상한 (6일째부터 하루 30)
pub const ATTEND_EXTRA_MAX: u64 = 10;
/// 연속 7일째·14일째…에 더 주는 보너스
pub const ATTEND_WEEK_BONUS: u64 = 50;
/// 작업 카드 1장 완료 보상. 카드는 자동으로 많이 만들 수 있어서 하루 상한을 둔다.
pub const CARD_REWARD: u64 = 6;
pub const CARD_DAILY_MAX: u32 = 10;
/// 고양이 쓰다듬기·들어 올리기 1번 보상과 하루 상한 (횟수)
pub const PET_REWARD: u64 = 2;
pub const PET_DAILY_MAX: u32 = 5;
/// 기억해 두는 완료 카드 수. 팀에 남는 끝난 카드보다 훨씬 많아서, 다시 열었다 닫은 카드도 걸러진다.
const PAID_CARDS_KEPT: usize = 500;

/// 딱 한 번 주는 기념 선물. `id`를 `RewardLog::gifts`에 적어 두 번 주지 않는다.
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Gift {
    pub id: &'static str,
    pub amount: u64,
    /// 잔액 옆 '+N ○○' 표시에 쓰는 말
    pub label: &'static str,
    /// 받을 때 보여 주는 안내 문구
    pub message: &'static str,
}

/// 지금 주는 선물: 업데이트하거나 새로 설치한 뒤 처음 켤 때 한 번. 양은 고양이 뽑기 1번 값.
/// 다음 기념 선물은 `id`를 새로 정하고 (필요하면 양·문구도) 바꾼다. 쓴 적 있는 id는 다시 쓰지 않는다.
pub const GIFT: Gift = Gift {
    id: "gift:release-next",
    amount: 250,
    label: "새 버전 기념",
    message: "새 버전 오픈 기념으로 츄르 250개를 드려요",
};

/// 방금 받은 보상 (화면의 '+N 출석' 표시용). kind: "attend" | "card" | "pet" | "gift"
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChuruReward {
    pub kind: &'static str,
    pub amount: u64,
    /// 출석일 때 연속 일수 (나머지는 0)
    pub streak: u32,
    /// 선물일 때만 있다
    pub gift: Option<Gift>,
}

fn pay(s: &mut Settings, kind: &'static str, amount: u64, streak: u32) -> ChuruReward {
    s.churu = s.churu.saturating_add(amount);
    ChuruReward { kind, amount, streak, gift: None }
}

/// 기념 선물. 이미 받은 id면 None.
pub fn gift_reward(s: &mut Settings, gift: Gift) -> Option<ChuruReward> {
    if s.rewards.gifts.iter().any(|id| id == gift.id) {
        return None;
    }
    s.rewards.gifts.push(gift.id.into());
    Some(ChuruReward { gift: Some(gift), ..pay(s, "gift", gift.amount, 0) })
}

/// 하루 상한이 있는 보상의 횟수를 센다. 받을 수 있으면 true.
/// 이미 센 날보다 앞선 날(시계를 뒤로 돌림)에는 주지 않는다.
fn take_daily(day: &mut i32, count: &mut u32, today: i32, max: u32) -> bool {
    if today > *day {
        *day = today;
        *count = 0;
    }
    if today < *day || *count >= max {
        return false;
    }
    *count += 1;
    true
}

/// 그날 첫 접속 보상. 오늘(또는 더 뒤 날짜로) 이미 받았으면 None.
pub fn attend_reward(s: &mut Settings, today: i32) -> Option<ChuruReward> {
    let r = &mut s.rewards;
    if today <= r.attend_day {
        return None;
    }
    r.streak = if today == r.attend_day + 1 { r.streak.saturating_add(1) } else { 1 };
    r.attend_day = today;
    let streak = r.streak;
    let extra = (u64::from(streak - 1) * ATTEND_STEP).min(ATTEND_EXTRA_MAX);
    let bonus = if streak % 7 == 0 { ATTEND_WEEK_BONUS } else { 0 };
    Some(pay(s, "attend", ATTEND_BASE + extra + bonus, streak))
}

/// 완료한 카드를 구별하는 이름. 팀을 새로 만들면 카드 번호(T-1…)가 다시 시작할 수 있어서 만든 시각도 넣는다.
pub fn card_key(project_id: &str, task_id: &str, created_at: u64) -> String {
    format!("{project_id}:{task_id}:{created_at}")
}

/// 작업 카드 완료 보상. 한 카드는 한 번만 계산한다: 상한 때문에 못 받은 카드도 적어 두어 다음 날 다시 받지 못한다.
pub fn card_reward(s: &mut Settings, key: &str, today: i32) -> Option<ChuruReward> {
    let r = &mut s.rewards;
    if r.paid_cards.iter().any(|k| k == key) {
        return None;
    }
    r.paid_cards.push(key.into());
    let over = r.paid_cards.len().saturating_sub(PAID_CARDS_KEPT);
    r.paid_cards.drain(..over);
    take_daily(&mut r.card_day, &mut r.card_count, today, CARD_DAILY_MAX).then(|| pay(s, "card", CARD_REWARD, 0))
}

/// 고양이 쓰다듬기·들어 올리기 보상 (하루 `PET_DAILY_MAX`번까지).
pub fn pet_reward(s: &mut Settings, today: i32) -> Option<ChuruReward> {
    let r = &mut s.rewards;
    take_daily(&mut r.pet_day, &mut r.pet_count, today, PET_DAILY_MAX).then(|| pay(s, "pet", PET_REWARD, 0))
}

/// 이 컴퓨터의 현지 날짜를 하루 단위 번호로 (어제 = 오늘 - 1)
fn today() -> i32 {
    use chrono::Datelike;
    chrono::Local::now().date_naive().num_days_from_ce()
}

/// 휴게실·놀이방 소품 가격 (츄르). 앱이 가격을 믿지 않도록 이 표가 기준이다.
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
    ("캣휠", 130),
    ("캣 터널", 90),
    ("장난감 상자", 40),
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

/// 뽑기 대상 고양이 11종 (흰 고양이는 처음부터 가져서 뺀다). (id, 등급, 가중치), 가중치 합 100 → 가중치가 곧 확률(%).
/// 한 마리당: 흔함 14% · 레어 8% · 에픽 6% · 유니크 5% · 레전더리 3%.
/// 근거: 한 달 약 4,780츄르 - 소품 930 = 3,850츄르 → 환급 없이 250씩 15번 뽑는다.
/// 15번 뽑으면 11종 중 평균 약 7.8종 (기댓값) → 흰 고양이 포함 약 9/12종. 샴을 얻을 확률은 약 37%.
/// id는 저장 데이터(Prefs.owned)에 쓰이므로 바꾸지 않는다.
pub const GACHA_CATS: &[(&str, &str, u32)] = &[
    ("grey", "흔함", 14),
    ("ginger", "흔함", 14),
    ("cream", "흔함", 14),
    ("bicolor", "흔함", 14),
    ("pink", "레어", 8),
    ("black", "레어", 8),
    ("silver", "레어", 8),
    ("brown", "에픽", 6),
    ("calico", "에픽", 6),
    ("tuxedo", "유니크", 5),
    ("siamese", "레전더리", 3),
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

/// 화면이 확률표를 그릴 때 쓰는 값. percent는 소수 첫째 자리까지.
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
        // Windows: folders imported earlier were saved as `\\?\C:\…`, which can't take work copies
        for p in &mut list {
            p.path = sys::plain_path(&p.path);
        }
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

    /// 보상 규칙 하나를 적용한다. 기록이 바뀌었을 수 있으니 저장하고, 받았으면 보상과 새 Settings를 돌려준다.
    fn reward(&self, rule: impl FnOnce(&mut Settings) -> Option<ChuruReward>) -> Option<(ChuruReward, Settings)> {
        let got = {
            let mut p = self.prefs.lock().unwrap();
            rule(&mut p).map(|r| (r, p.clone()))
        };
        self.save_prefs();
        got
    }

    /// 작업 카드 하나가 완료됐다 (`card_reward`).
    pub fn reward_card(&self, key: &str) -> Option<(ChuruReward, Settings)> {
        self.reward(|s| card_reward(s, key, today()))
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

    /// 팀원 털색 고르기 (`set_coat`). 성공하면 저장하고 새 Settings를 돌려준다.
    pub fn choose_coat(&self, member: &str, coat: Option<&str>) -> Result<Settings, String> {
        let snap = {
            let mut p = self.prefs.lock().unwrap();
            set_coat(&mut p, member, coat)?;
            p.clone()
        };
        self.save_prefs();
        Ok(snap)
    }

    /// 고양이 이름 짓기 (`set_cat_name`). 성공하면 저장하고 새 Settings를 돌려준다.
    pub fn rename_cat(&self, member: &str, name: Option<&str>) -> Result<Settings, String> {
        let snap = {
            let mut p = self.prefs.lock().unwrap();
            set_cat_name(&mut p, member, name)?;
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

    /// The work of `project_create` (blocking: run it off the main thread).
    pub fn create(&self, name: &str) -> Result<Project, String> {
        let name = name.trim();
        if name.is_empty() || name.starts_with('.') || name.contains(['/', '\\', ':']) {
            return Err("폴더 이름으로 쓸 수 없는 이름이에요".into());
        }
        let dir = self.root.lock().unwrap().join(name);
        if dir.exists() {
            return Err("같은 이름의 프로젝트가 이미 있어요".into());
        }
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        sys::init_new_repo(&dir.to_string_lossy())?;
        let path = dir.to_string_lossy().into_owned();
        self.sync();
        let p = self.list.lock().unwrap().iter().find(|p| p.path == path).cloned().ok_or("생성 실패")?;
        self.update(&p.id, |p| p.last_opened = now_ms())
    }

    /// The work of `project_import` (blocking: run it off the main thread).
    pub fn import(&self, path: &str) -> Result<Project, String> {
        let dir = PathBuf::from(path.trim());
        if !dir.is_dir() {
            return Err("폴더를 찾을 수 없어요".into());
        }
        let dir = sys::real_dir(dir);
        let path = dir.to_string_lossy().into_owned();
        if let Some(home) = std::env::home_dir() {
            if dir == home || dir.parent().is_none() {
                return Err("홈 폴더나 디스크 전체는 프로젝트로 가져올 수 없어요. 프로젝트 폴더를 골라주세요.".into());
            }
        }
        let existing = self.sync().into_iter().find(|p| p.path == path);
        if let Some(p) = existing {
            return self.update(&p.id, |p| p.last_opened = now_ms());
        }
        let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "프로젝트".into());
        let p = Project {
            id: uuid::Uuid::new_v4().to_string()[..8].to_string(),
            name,
            is_git: dir.join(".git").exists(),
            path,
            team: self.default_team(),
            last_opened: now_ms(),
            knowledge: String::new(),
            linked: true,
        };
        let mut list = self.list.lock().unwrap();
        list.push(p.clone());
        self.save(&list);
        Ok(p)
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

/// Reads the workspace folder (one disk look per subfolder): off the main thread, so the window
/// never waits on the disk.
#[tauri::command]
pub async fn projects_list(app: AppHandle) -> Vec<Project> {
    tauri::async_runtime::spawn_blocking(move || app.state::<Projects>().sync()).await.unwrap_or_default()
}

#[tauri::command]
pub fn workspace_root(projects: State<'_, Projects>) -> String {
    projects.root.lock().unwrap().to_string_lossy().into_owned()
}

#[tauri::command]
pub async fn workspace_set_root(app: AppHandle, path: String) -> Result<Vec<Project>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let projects = app.state::<Projects>();
        let dir = PathBuf::from(&path);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        *projects.root.lock().unwrap() = dir;
        projects.save_prefs();
        Ok(projects.sync())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// New project = new folder in the workspace with a git repo and a first commit.
/// git runs several programs (about 0.1–0.2 s): never on the main thread, or the window freezes.
#[tauri::command]
pub async fn project_create(app: AppHandle, name: String) -> Result<Project, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<Projects>().create(&name)).await.map_err(|e| e.to_string())?
}

/// "다른 위치의 폴더 가져오기": make a project of a folder outside the workspace. Nothing in the
/// folder changes now (a folder without git gets one when its team first clocks in).
#[tauri::command]
pub async fn project_import(app: AppHandle, path: String) -> Result<Project, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<Projects>().import(&path)).await.map_err(|e| e.to_string())?
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

/// 팀원 털색을 고른다 (`coat` null = 자동으로 되돌리기). 저장된 Settings를 돌려주고 "prefs" 이벤트를 보낸다.
#[tauri::command]
pub fn prefs_set_coat(app: AppHandle, projects: State<'_, Projects>, member: String, coat: Option<String>) -> Result<Settings, String> {
    let s = projects.choose_coat(&member, coat.as_deref())?;
    let _ = app.emit("prefs", &s);
    Ok(s)
}

/// 고양이 이름을 짓는다 (`name` null = 원래 이름으로). 저장된 Settings를 돌려주고 "prefs" 이벤트를 보낸다.
#[tauri::command]
pub fn prefs_set_cat_name(app: AppHandle, projects: State<'_, Projects>, member: String, name: Option<String>) -> Result<Settings, String> {
    let s = projects.rename_cat(&member, name.as_deref())?;
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

fn announce_reward(app: &AppHandle, got: Option<(ChuruReward, Settings)>) -> Option<ChuruReward> {
    got.map(|(reward, s)| {
        let _ = app.emit("prefs", &s);
        reward
    })
}

/// 앱을 열었거나 다시 돌아왔다: 그날 처음이면 출석 보상. 이미 받았으면 null.
#[tauri::command]
pub fn reward_attend(app: AppHandle, projects: State<'_, Projects>) -> Option<ChuruReward> {
    announce_reward(&app, projects.reward(|s| attend_reward(s, today())))
}

/// 앱을 켰다: 아직 안 받은 기념 선물(`GIFT`)이 있으면 준다. 받은 적 있으면 null.
#[tauri::command]
pub fn reward_gift(app: AppHandle, projects: State<'_, Projects>) -> Option<ChuruReward> {
    announce_reward(&app, projects.reward(|s| gift_reward(s, GIFT)))
}

/// 고양이를 쓰다듬거나 들어 올렸다. 오늘 상한을 넘었으면 null.
#[tauri::command]
pub fn reward_pet(app: AppHandle, projects: State<'_, Projects>) -> Option<ChuruReward> {
    announce_reward(&app, projects.reward(|s| pet_reward(s, today())))
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
pub async fn worktrees_list(path: String) -> Vec<sys::WorktreeInfo> {
    tauri::async_runtime::spawn_blocking(move || sys::worktrees(&path)).await.unwrap_or_default()
}

#[tauri::command]
pub async fn git_changes(cwd: String) -> Vec<sys::Change> {
    tauri::async_runtime::spawn_blocking(move || sys::changes(&cwd)).await.unwrap_or_default()
}

#[tauri::command]
pub async fn git_diff(cwd: String, path: String) -> String {
    tauri::async_runtime::spawn_blocking(move || sys::diff(&cwd, &path)).await.unwrap_or_default()
}

#[cfg(test)]
mod churu_tests {
    use super::*;

    fn fresh() -> Settings {
        Settings::default()
    }

    #[test]
    fn churu_is_paid_at_double_the_old_rate() {
        // 예전에는 25,000토큰에 1개였다: 같은 토큰으로 이제 2개
        assert_eq!(churu_add(0, 0, 25_000), (2, 0));
        assert_eq!(churu_add(0, 0, 1_000_000), (80, 0));
        // 이미 모은 츄르는 다시 계산하지 않는다
        assert_eq!(churu_add(100, 0, 0), (100, 0));
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
    fn only_owned_coats_can_be_chosen_and_auto_removes_the_pick() {
        let mut s = fresh();
        assert!(set_coat(&mut s, "p1:worker:W1", Some("black")).unwrap_err().contains("상점"));
        assert!(set_coat(&mut s, "", Some("white")).is_err());
        assert!(s.coats.is_empty());
        s.owned.push("cat:black".into());
        set_coat(&mut s, "p1:worker:W1", Some("black")).unwrap();
        set_coat(&mut s, "p2:worker:W1", Some("white")).unwrap();
        assert_eq!(s.coats["p1:worker:W1"], "black");
        set_coat(&mut s, "p1:worker:W1", None).unwrap();
        assert_eq!(s.coats.keys().collect::<Vec<_>>(), vec!["p2:worker:W1"]);
    }

    #[test]
    fn cat_name_is_trimmed_limited_and_can_go_back() {
        let mut s = fresh();
        assert!(set_cat_name(&mut s, "", Some("콩이")).is_err());
        assert!(set_cat_name(&mut s, "p1:worker:W1", Some("   ")).is_err());
        assert!(set_cat_name(&mut s, "p1:worker:W1", Some("가나다라마바사아자차카타파")).unwrap_err().contains("12자"));
        assert!(set_cat_name(&mut s, "p1:worker:W1", Some("콩\n이")).is_err());
        assert!(s.cat_names.is_empty());
        set_cat_name(&mut s, "p1:worker:W1", Some("  가나다라마바사아자차카타 ")).unwrap();
        assert_eq!(s.cat_names["p1:worker:W1"], "가나다라마바사아자차카타");
        set_cat_name(&mut s, "p1:worker:W1", None).unwrap();
        assert!(s.cat_names.is_empty());
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
    fn gacha_weights_sum_to_100_with_eleven_cats() {
        let total: u32 = GACHA_CATS.iter().map(|c| c.2).sum();
        assert_eq!(total, 100);
        assert_eq!(GACHA_CATS.len(), 11);
        // white(기본 보유)은 뽑기 대상이 아니다
        assert!(GACHA_CATS.iter().all(|c| c.0 != "white"));
        assert_eq!(GACHA_PRICE, 250);
    }

    #[test]
    fn pick_boundaries_follow_weights() {
        assert_eq!(pick_cat(&mut || 0), "grey");
        assert_eq!(pick_cat(&mut || 13), "grey");
        assert_eq!(pick_cat(&mut || 14), "ginger");
        assert_eq!(pick_cat(&mut || 55), "bicolor"); // 14×4 = 56 미만이면 흔함
        assert_eq!(pick_cat(&mut || 56), "pink");
        assert_eq!(pick_cat(&mut || 80), "brown"); // 56 + 8×3 = 80부터 에픽
        assert_eq!(pick_cat(&mut || 92), "tuxedo");
        assert_eq!(pick_cat(&mut || 96), "tuxedo");
        assert_eq!(pick_cat(&mut || 97), "siamese");
        assert_eq!(pick_cat(&mut || 99), "siamese");
    }

    #[test]
    fn pick_over_one_full_cycle_matches_percent() {
        // 난수 0..100을 한 번씩 넣으면 각 고양이가 정확히 자기 확률(%)만큼 나온다
        for (id, _, w) in GACHA_CATS {
            let hits = (0..100u32).filter(|&x| pick_cat(&mut || x) == *id).count();
            assert_eq!(hits, *w as usize, "{id}");
        }
    }

    #[test]
    fn pick_skips_values_outside_even_range() {
        // u32::MAX 근처 값은 100으로 똑같이 나눠지지 않아 버리고 다시 뽑는다 (치우침 방지)
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
    fn gacha_info_lists_five_tiers_summing_to_100_percent() {
        let info = gacha_info_value();
        assert_eq!(info.price, 250);
        assert_eq!(info.cats.len(), 11);
        assert_eq!(info.cats.iter().map(|c| c.percent).sum::<f64>(), 100.0);
        // (등급, 한 마리당 확률, 그 등급의 고양이)
        let expected: &[(&str, f64, &[&str])] = &[
            ("흔함", 14.0, &["grey", "ginger", "cream", "bicolor"]),
            ("레어", 8.0, &["pink", "black", "silver"]),
            ("에픽", 6.0, &["brown", "calico"]),
            ("유니크", 5.0, &["tuxedo"]),
            ("레전더리", 3.0, &["siamese"]),
        ];
        for (tier, percent, ids) in expected {
            let found: Vec<&str> = info.cats.iter().filter(|c| c.tier == *tier).map(|c| c.id).collect();
            assert_eq!(found, ids.to_vec(), "{tier}");
            assert!(info.cats.iter().filter(|c| c.tier == *tier).all(|c| c.percent == *percent), "{tier}");
        }
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


#[cfg(test)]
mod reward_tests {
    use super::*;

    const DAY: i32 = 740_000;

    #[test]
    fn attendance_pays_once_a_day() {
        let mut s = Settings::default();
        assert_eq!(attend_reward(&mut s, DAY), Some(ChuruReward { kind: "attend", amount: 20, streak: 1, gift: None }));
        assert_eq!(attend_reward(&mut s, DAY), None);
        assert_eq!(s.churu, 20);
        // 시계를 어제로 돌려도 다시 받지 못한다
        assert_eq!(attend_reward(&mut s, DAY - 1), None);
        assert_eq!(s.churu, 20);
    }

    #[test]
    fn streak_grows_with_weekly_bonus_and_resets_after_a_gap() {
        let mut s = Settings::default();
        let got: Vec<u64> = (0..14).map(|i| attend_reward(&mut s, DAY + i).unwrap().amount).collect();
        assert_eq!(got, vec![20, 22, 24, 26, 28, 30, 80, 30, 30, 30, 30, 30, 30, 80]);
        // 하루를 건너뛰면 처음부터
        let back = attend_reward(&mut s, DAY + 15).unwrap();
        assert_eq!((back.amount, back.streak), (20, 1));
    }

    #[test]
    fn four_weeks_of_everything_stays_under_a_third_of_token_income() {
        let mut s = Settings::default();
        for d in 0..28 {
            attend_reward(&mut s, DAY + d);
            for n in 0..30 {
                card_reward(&mut s, &format!("p:T-{d}-{n}:1"), DAY + d);
                pet_reward(&mut s, DAY + d);
            }
        }
        assert_eq!(s.churu, 1_010 + 1_680 + 280);
        assert!(s.churu < 9_600 / 3);
    }

    #[test]
    fn same_card_is_never_paid_twice() {
        let mut s = Settings::default();
        let key = card_key("p", "T-1", 100);
        assert_eq!(card_reward(&mut s, &key, DAY).map(|r| r.amount), Some(CARD_REWARD));
        assert_eq!(card_reward(&mut s, &key, DAY), None);
        assert_eq!(card_reward(&mut s, &key, DAY + 1), None);
        assert_eq!(s.churu, CARD_REWARD);
        // 번호가 같아도 다른 팀이나 새로 만든 카드는 다른 카드
        assert!(card_reward(&mut s, &card_key("q", "T-1", 100), DAY + 1).is_some());
        assert!(card_reward(&mut s, &card_key("p", "T-1", 200), DAY + 1).is_some());
    }

    #[test]
    fn card_cap_resets_next_day_but_skipped_cards_stay_skipped() {
        let mut s = Settings::default();
        let paid = (0..15).filter(|n| card_reward(&mut s, &format!("c{n}"), DAY).is_some()).count();
        assert_eq!(paid, CARD_DAILY_MAX as usize);
        assert_eq!(card_reward(&mut s, "c14", DAY + 1), None);
        assert!(card_reward(&mut s, "new", DAY + 1).is_some());
        assert_eq!(s.churu, CARD_REWARD * 11);
    }

    #[test]
    fn paid_card_list_stays_bounded() {
        let mut s = Settings::default();
        for n in 0..PAID_CARDS_KEPT + 20 {
            card_reward(&mut s, &format!("c{n}"), DAY);
        }
        assert_eq!(s.rewards.paid_cards.len(), PAID_CARDS_KEPT);
        assert_eq!(s.rewards.paid_cards[0], "c20");
    }

    #[test]
    fn petting_is_capped_per_day() {
        let mut s = Settings::default();
        let paid = (0..20).filter(|_| pet_reward(&mut s, DAY).is_some()).count();
        assert_eq!(paid, PET_DAILY_MAX as usize);
        assert_eq!(s.churu, 10);
        assert!(pet_reward(&mut s, DAY + 1).is_some());
        // 시계를 뒤로 돌려도 상한이 풀리지 않는다
        assert_eq!(pet_reward(&mut s, DAY), None);
        assert_eq!(s.churu, 12);
    }

    #[test]
    fn gift_is_paid_once_per_id() {
        let mut s = Settings::default();
        let got = gift_reward(&mut s, GIFT).unwrap();
        assert_eq!((got.kind, got.amount, got.gift), ("gift", 250, Some(GIFT)));
        assert_eq!(gift_reward(&mut s, GIFT), None);
        assert_eq!(s.churu, 250);
        // 다음 기념 선물은 id만 바꾸면 한 번 더 받고, 앞의 선물은 그대로 받은 것으로 남는다
        let next = Gift { id: "gift:another", ..GIFT };
        assert!(gift_reward(&mut s, next).is_some());
        assert_eq!(gift_reward(&mut s, next), None);
        assert_eq!(gift_reward(&mut s, GIFT), None);
        assert_eq!(s.churu, 500);
    }

    #[test]
    fn gift_reaches_updaters_once_and_survives_restart() {
        // 예전 버전이 저장한 설정(선물 기록 없음)으로 업데이트한 경우. 임시 dev.prism.* 폴더만 쓴다
        let dir = std::env::temp_dir().join(format!("dev.prism.t126-{}", uuid::Uuid::new_v4()));
        let file = dir.join("settings.json");
        let open = |saved: Settings| Projects { list: Mutex::new(vec![]), file: Mutex::new(None), root: Mutex::new(dir.join("ws")), settings: Some(file.clone()), prefs: Mutex::new(saved) };
        let old: Settings = serde_json::from_str(r#"{"root":null,"providers":["claude"],"onboarded":true,"churu":30,"rewards":{"attendDay":739999,"streak":2}}"#).unwrap();
        let first = open(old);
        assert!(first.reward(|s| gift_reward(s, GIFT)).is_some());
        let again = open(serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap());
        assert!(again.reward(|s| gift_reward(s, GIFT)).is_none());
        assert_eq!(again.settings().churu, 280);
        assert_eq!(again.settings().rewards.streak, 2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reward_log_survives_restart() {
        // 저장한 파일을 다시 읽어도(앱 재시작) 같은 보상을 또 받지 않는다. 정식 데이터가 아닌 임시 dev.prism.* 폴더를 쓴다
        let dir = std::env::temp_dir().join(format!("dev.prism.t123-{}", uuid::Uuid::new_v4()));
        let file = dir.join("settings.json");
        let open = |saved: Settings| Projects { list: Mutex::new(vec![]), file: Mutex::new(None), root: Mutex::new(dir.join("ws")), settings: Some(file.clone()), prefs: Mutex::new(saved) };
        let first = open(Settings::default());
        assert!(first.reward(|s| attend_reward(s, DAY)).is_some());
        assert!(first.reward(|s| card_reward(s, "p:T-1:1", DAY)).is_some());
        let again = open(serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap());
        assert!(again.reward(|s| attend_reward(s, DAY)).is_none());
        assert!(again.reward(|s| card_reward(s, "p:T-1:1", DAY)).is_none());
        assert_eq!(again.settings().churu, ATTEND_BASE + CARD_REWARD);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod create_tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn scratch() -> (PathBuf, Projects) {
        // 정식 데이터는 건드리지 않는다: 임시 폴더 안의 dev.prism.* 전용 폴더만 쓴다
        let root = std::env::temp_dir().join(format!("dev.prism.t117-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("ws")).unwrap();
        let ps = Projects { list: Mutex::new(vec![]), file: Mutex::new(Some(root.join("data/projects.json"))), root: Mutex::new(root.join("ws")), settings: None, prefs: Mutex::new(Settings::default()) };
        (root, ps)
    }

    /// Runs `work` while a pretend screen thread ticks every 1 ms; returns (work ms, longest screen stall ms).
    /// `inline`: the work runs on the screen thread itself (the old sync command), else beside it.
    fn stall(inline: bool, work: impl FnOnce() + Send + 'static) -> (f64, f64) {
        let t = Instant::now();
        let mut worst = Duration::ZERO;
        if inline {
            work();
            worst = t.elapsed();
        } else {
            let h = std::thread::spawn(work);
            let mut last = Instant::now();
            while !h.is_finished() {
                std::thread::sleep(Duration::from_millis(1));
                worst = worst.max(last.elapsed());
                last = Instant::now();
            }
            h.join().unwrap();
        }
        (t.elapsed().as_secs_f64() * 1000.0, worst.as_secs_f64() * 1000.0)
    }

    #[test]
    fn chosen_coat_is_still_there_after_reading_the_settings_file_again() {
        let (root, mut ps) = scratch();
        let file = root.join("data/settings.json");
        ps.settings = Some(file.clone());
        ps.prefs.lock().unwrap().owned.push("cat:black".into());
        ps.choose_coat("p1:lead:총괄", Some("black")).unwrap();
        let again: Settings = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(again.coats["p1:lead:총괄"], "black");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn cat_name_is_still_there_after_reading_the_settings_file_again() {
        let (root, mut ps) = scratch();
        let file = root.join("data/settings.json");
        ps.settings = Some(file.clone());
        ps.rename_cat("p1:lead:총괄", Some("대장")).unwrap();
        let again: Settings = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(again.cat_names["p1:lead:총괄"], "대장");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn new_project_gets_a_repo_with_a_first_commit() {
        let (root, ps) = scratch();
        let p = ps.create("우리 쇼핑몰").unwrap();
        assert!(p.is_git);
        assert_eq!(p.name, "우리 쇼핑몰");
        assert!(sys::git(&p.path, &["rev-parse", "--verify", "HEAD"]).is_ok());
        assert_eq!(sys::current_branch(&p.path).as_deref(), Some("main"));
        let ex = std::fs::read_to_string(PathBuf::from(&p.path).join(".git/info/exclude")).unwrap();
        assert!(ex.lines().any(|l| l == ".prism/"));
        assert!(ps.create("우리 쇼핑몰").err().unwrap().contains("이미"));
        assert!(ps.create("a/b").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 고치기 전/후 시간: `cargo test create_timing -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn create_timing() {
        let (root, ps) = scratch();
        let ps = std::sync::Arc::new(ps);
        let (mut before, mut after) = (vec![], vec![]);
        for i in 0..8 {
            // before: 6 git programs, on the screen thread
            let p2 = ps.clone();
            before.push(stall(true, move || {
                let dir = p2.root.lock().unwrap().join(format!("old{i}"));
                std::fs::create_dir_all(&dir).unwrap();
                sys::ensure_repo(&dir.to_string_lossy()).unwrap();
                p2.sync();
            }));
            // after: 3 git programs, beside the screen thread
            let p2 = ps.clone();
            after.push(stall(false, move || {
                p2.create(&format!("new{i}")).unwrap();
            }));
        }
        let avg = |v: &[(f64, f64)], k: usize| v.iter().map(|x| if k == 0 { x.0 } else { x.1 }).sum::<f64>() / v.len() as f64;
        eprintln!("BEFORE make {:.0} ms, screen stalled {:.0} ms", avg(&before, 0), avg(&before, 1));
        eprintln!("AFTER  make {:.0} ms, screen stalled {:.1} ms", avg(&after, 0), avg(&after, 1));
        let _ = std::fs::remove_dir_all(&root);
    }
}
