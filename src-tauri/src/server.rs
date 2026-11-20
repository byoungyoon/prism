//! Loopback HTTP server the agents call back into:
//!   POST /mcp/{project}/{agent}            — MCP (streamable HTTP, JSON responses)
//!   POST /hook/{project}/{agent}/{event}   — Claude Code hooks
//!   POST /status/{project}/{agent}         — Claude Code status line (cost)
//! Bound to 127.0.0.1 and gated by a per-launch random token.

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde_json::{json, Value};

use crate::team::{PermWait, TeamManager};

type Ctx = Arc<TeamManager>;
type Q = Query<HashMap<String, String>>;

fn authed(ctx: &Ctx, q: &Q) -> bool {
    q.get("t").map(|t| t == &ctx.token).unwrap_or(false)
}

pub async fn bind() -> (tokio::net::TcpListener, u16) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("bind loopback");
    let port = listener.local_addr().unwrap().port();
    (listener, port)
}

pub async fn serve(listener: tokio::net::TcpListener, ctx: Ctx) {
    let app = Router::new()
        .route("/mcp/{project}/{agent}", post(mcp).get(|| async { StatusCode::METHOD_NOT_ALLOWED }))
        .route("/hook/{project}/{agent}/{event}", post(hook))
        .route("/status/{project}/{agent}", post(status))
        .route("/perm/{project}/{agent}", post(perm))
        .with_state(ctx);
    let _ = axum::serve(listener, app).await;
}

async fn hook(State(ctx): State<Ctx>, Path((p, a, ev)): Path<(String, String, String)>, q: Q, body: String) -> StatusCode {
    if !authed(&ctx, &q) {
        return StatusCode::UNAUTHORIZED;
    }
    let payload = serde_json::from_str(&body).unwrap_or(Value::Null);
    let _ = tokio::task::spawn_blocking(move || ctx.on_hook(&p, &a, &ev, payload)).await;
    StatusCode::OK
}

/// PermissionRequest hook: hold the request until the user answers in the app (or ~9 min pass,
/// after which Claude Code falls back to its own terminal prompt).
async fn perm(State(ctx): State<Ctx>, Path((p, a)): Path<(String, String)>, q: Q, body: String) -> Response {
    if !authed(&ctx, &q) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let payload: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
    let c = ctx.clone();
    let (p2, a2) = (p.clone(), a.clone());
    let wait = tokio::task::spawn_blocking(move || c.permission_request(&p2, &a2, &payload)).await;
    let decision = match wait {
        Ok(PermWait::Now(d)) => d,
        Ok(PermWait::Wait(id, rx)) => match tokio::time::timeout(std::time::Duration::from_secs(570), rx).await {
            Ok(Ok(d)) => d,
            _ => {
                let _ = tokio::task::spawn_blocking(move || ctx.answer_permission(&p, id, "timeout")).await;
                ""
            }
        },
        Err(_) => "",
    };
    let body = match decision {
        "allow" => json!({ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": { "behavior": "allow" } } }),
        "deny" => json!({ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": { "behavior": "deny", "message": "사용자가 Prism에서 거부했어요." } } }),
        _ => json!({}),
    };
    Json(body).into_response()
}

async fn status(State(ctx): State<Ctx>, Path((p, a)): Path<(String, String)>, q: Q, body: String) -> Response {
    if !authed(&ctx, &q) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let payload = serde_json::from_str(&body).unwrap_or(Value::Null);
    tokio::task::spawn_blocking(move || ctx.on_status(&p, &a, payload)).await.unwrap_or_default().into_response()
}

async fn mcp(State(ctx): State<Ctx>, Path((p, a)): Path<(String, String)>, q: Q, Json(req): Json<Value>) -> Response {
    if !authed(&ctx, &q) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Some(id) = req.get("id").cloned() else {
        // notifications (e.g. notifications/initialized) get no body
        return StatusCode::ACCEPTED.into_response();
    };
    let method = req.get("method").and_then(Value::as_str).unwrap_or("").to_string();
    let params = req.get("params").cloned().unwrap_or(Value::Null);

    let result = match method.as_str() {
        "initialize" => Ok(json!({
            "protocolVersion": params.get("protocolVersion").cloned().unwrap_or(json!("2025-06-18")),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "prism", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "Prism 팀 도구. 작업 카드로 하청(delegate), 보고(report), 질문(escalate)."
        })),
        "ping" => Ok(json!({})),
        "tools/list" => {
            let tools = tokio::task::spawn_blocking(move || ctx.tools_for(&p, &a)).await.unwrap_or_default();
            Ok(json!({ "tools": tools }))
        }
        "tools/call" if params.get("name").and_then(Value::as_str) == Some("approve") => {
            // Claude Code's permission prompt: ask the person in Prism, wait for the answer
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            let input = args.get("input").cloned().unwrap_or(json!({}));
            let payload = json!({ "tool_name": args.get("tool_name").cloned().unwrap_or(json!("도구")), "tool_input": input.clone() });
            let c = ctx.clone();
            let (p2, a2) = (p.clone(), a.clone());
            let wait = tokio::task::spawn_blocking(move || c.permission_request(&p2, &a2, &payload)).await;
            let decision = match wait {
                Ok(PermWait::Now(d)) => d,
                Ok(PermWait::Wait(id, rx)) => match tokio::time::timeout(std::time::Duration::from_secs(570), rx).await {
                    Ok(Ok(d)) => d,
                    _ => {
                        let c = ctx.clone();
                        let _ = tokio::task::spawn_blocking(move || c.answer_permission(&p, id, "timeout")).await;
                        "deny"
                    }
                },
                Err(_) => "deny",
            };
            let verdict = if decision == "allow" {
                json!({ "behavior": "allow", "updatedInput": input })
            } else {
                json!({ "behavior": "deny", "message": "사용자가 허락하지 않았어요. 다른 방법을 찾거나 escalate로 물어보세요." })
            };
            Ok(json!({ "content": [{ "type": "text", "text": verdict.to_string() }] }))
        }
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("").to_string();
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            let out = tokio::task::spawn_blocking(move || ctx.call_tool(&p, &a, &name, args))
                .await
                .unwrap_or_else(|e| Err(e.to_string()));
            Ok(match out {
                Ok(text) => json!({ "content": [{ "type": "text", "text": text }] }),
                Err(text) => json!({ "content": [{ "type": "text", "text": text }], "isError": true }),
            })
        }
        _ => Err(json!({ "code": -32601, "message": format!("method not found: {method}") })),
    };

    let body = match result {
        Ok(r) => json!({ "jsonrpc": "2.0", "id": id, "result": r }),
        Err(e) => json!({ "jsonrpc": "2.0", "id": id, "error": e }),
    };
    Json(body).into_response()
}
