#!/usr/bin/env python3
"""Live E2E test — real LLM calls via running Docker API.

Simulates a real student studying for "Grundlagen der Datenbanken" exam.
Tests the full chain: HTTP → Orchestrator → LLM (OpenRouter/Zhipu) → SSE events.

Usage:
    python tests/e2e_tutor_live.py

Requires:
    - Docker containers running (backend-api-1 on localhost:8003)
    - Valid OpenRouter API key in .env
    - DB-L05-SQL material with completed analysis
"""

import json
import sys
import time
import httpx

API_BASE = "http://localhost:8003/api/v1"
MATERIAL_ID_SQL = "14a0ca92-2f73-4607-a7fe-9b2696e420dc"
MATERIAL_ID_NO_ANALYSIS = "644c9a02-fb8a-424f-99de-ca11fcb2c317"

# Module IDs
MODULE_JOIN = "8ec4a520-3f4c-41ae-9778-c99a8580fe73"
MODULE_DDL = "b3ed4a75-327d-4e7b-aec5-9f0682a357dc"


def login():
    """Get auth token."""
    r = httpx.post(f"{API_BASE}/auth/login", json={
        "email": "demo@zhijie.dev",
        "password": "demo1234",
    })
    r.raise_for_status()
    return r.json()["access_token"]


def send_tutor_request(token, material_id, message, module_id=None, history=None):
    """Send tutor chat request and collect SSE events."""
    body = {
        "material_id": material_id,
        "user_message": message,
    }
    if module_id:
        body["module_id"] = module_id
    if history:
        body["conversation_history"] = history

    events = []
    answer_parts = []
    start = time.monotonic()

    with httpx.stream(
        "POST",
        f"{API_BASE}/chat/tutor",
        json=body,
        headers={"Authorization": f"Bearer {token}"},
        timeout=60.0,
    ) as response:
        if response.status_code != 200:
            print(f"  ❌ HTTP {response.status_code}: {response.read().decode()[:200]}")
            return None

        for line in response.iter_lines():
            if not line:
                continue
            if line.startswith("event:"):
                current_event = line[6:].strip()
            elif line.startswith("data:"):
                data_str = line[5:].strip()
                try:
                    data = json.loads(data_str)
                except json.JSONDecodeError:
                    continue

                events.append({"event": current_event, "data": data})

                if current_event == "answer.delta":
                    answer_parts.append(data.get("content", ""))

    elapsed = int((time.monotonic() - start) * 1000)
    full_answer = "".join(answer_parts)

    return {
        "events": events,
        "answer": full_answer,
        "elapsed_ms": elapsed,
        "event_types": [e["event"] for e in events],
    }


def print_result(label, result):
    """Pretty-print test result."""
    if result is None:
        print(f"\n{'='*60}")
        print(f"❌ {label} — REQUEST FAILED")
        return False

    print(f"\n{'='*60}")
    print(f"🧪 {label}")
    print(f"   ⏱  {result['elapsed_ms']}ms")

    for e in result["events"]:
        evt = e["event"]
        d = e["data"]
        if evt == "session.started":
            print(f"   📋 session.started | tools={d.get('available_tools')}")
        elif evt == "plan.completed":
            print(f"   🎯 plan | intent={d['intent']} tools={d['tools_to_call']}")
            if d.get("reasoning"):
                print(f"         reasoning: {d['reasoning'][:80]}")
        elif evt == "tool.result":
            ok = "✅" if d["ok"] else "❌"
            extra = ""
            if d["ok"] and d.get("data"):
                if "module_name" in d["data"]:
                    extra = f" → {d['data']['module_name']}"
                if "questions_count" in d["data"]:
                    extra += f" ({d['data']['questions_count']}题)"
                    if d["data"].get("module_matched"):
                        extra += " [模块匹配]"
            else:
                err = d.get("error", {})
                extra = f" error={err.get('code', '?')}: {err.get('message', '')[:40]}"
            print(f"   {ok} {d['tool_name']}{extra}")
        elif evt == "answer.completed":
            print(f"   ✍️  answer ({d.get('total_tokens', 0)} tokens)")
        elif evt == "error":
            print(f"   ❗ ERROR: {d.get('message', '')[:60]}")
        elif evt == "session.completed":
            print(f"   🏁 done")

    print(f"\n   💬 回答:")
    # Print answer with line wrap
    ans = result["answer"]
    for i in range(0, len(ans), 70):
        print(f"      {ans[i:i+70]}")

    # Validate
    ok = True
    if "error" in result["event_types"] and "session.completed" not in result["event_types"]:
        print(f"\n   ⚠️ 存在错误且未正常结束")
        ok = False
    if not result["answer"]:
        print(f"\n   ⚠️ 没有收到回答")
        ok = False

    return ok


def main():
    print("🚀 智阶 Tutor MVP — 真实用户场景 E2E 测试")
    print("=" * 60)

    # Login
    try:
        token = login()
        print(f"✅ 登录成功 (demo@zhijie.dev)")
    except Exception as e:
        print(f"❌ 登录失败: {e}")
        sys.exit(1)

    results = []
    conversation_history = []

    # ── UC1: 学生开场白 ──────────────────────────────────────────
    r = send_tutor_request(
        token, MATERIAL_ID_SQL,
        "你好，我在复习数据库基础，后天就要考试了，帮帮我",
    )
    ok = print_result("UC1: 学生开场白 — '你好，帮帮我'", r)
    results.append(("UC1 开场白", ok))
    if r and r["answer"]:
        conversation_history.extend([
            {"role": "user", "content": "你好，我在复习数据库基础，后天就要考试了，帮帮我"},
            {"role": "assistant", "content": r["answer"]},
        ])

    # ── UC2: 讲解 JOIN ───────────────────────────────────────────
    r = send_tutor_request(
        token, MATERIAL_ID_SQL,
        "讲讲 SQL 的 JOIN，特别是 INNER JOIN 和 LEFT JOIN 的区别",
        history=conversation_history,
    )
    ok = print_result("UC2: 讲解 JOIN — 'INNER JOIN vs LEFT JOIN'", r)
    results.append(("UC2 讲解JOIN", ok))
    if r and r["answer"]:
        conversation_history.extend([
            {"role": "user", "content": "讲讲 SQL 的 JOIN，特别是 INNER JOIN 和 LEFT JOIN 的区别"},
            {"role": "assistant", "content": r["answer"]},
        ])

    # ── UC3: 指定模块讲解 ────────────────────────────────────────
    r = send_tutor_request(
        token, MATERIAL_ID_SQL,
        "DDL 里面 CREATE TABLE 的时候，约束怎么写？主键、外键、CHECK 这些",
        module_id=MODULE_DDL,
    )
    ok = print_result("UC3: DDL 约束 — 指定模块 module_id", r)
    results.append(("UC3 DDL约束", ok))

    # ── UC4: 出题测验 ────────────────────────────────────────────
    r = send_tutor_request(
        token, MATERIAL_ID_SQL,
        "出几道 SQL 的选择题测试一下我的水平",
    )
    ok = print_result("UC4: 出题 — '出几道 SQL 选择题'", r)
    results.append(("UC4 出题", ok))

    # ── UC5: 复合请求 ────────────────────────────────────────────
    r = send_tutor_request(
        token, MATERIAL_ID_SQL,
        "先简单讲讲 SQL 视图是什么，然后出两道相关的题",
    )
    ok = print_result("UC5: 复合请求 — '讲讲视图 + 出题'", r)
    results.append(("UC5 复合请求", ok))

    # ── UC6: 简单知识问答 ────────────────────────────────────────
    r = send_tutor_request(
        token, MATERIAL_ID_SQL,
        "NULL 在 SQL 里是什么意思？跟空字符串一样吗？",
    )
    ok = print_result("UC6: 知识问答 — 'NULL 是什么'", r)
    results.append(("UC6 NULL问答", ok))

    # ── UC7: 我学的怎么样 ────────────────────────────────────────
    r = send_tutor_request(
        token, MATERIAL_ID_SQL,
        "我学的怎么样？哪些地方需要重点复习？",
    )
    ok = print_result("UC7: 掌握度 — '我学的怎么样'", r)
    results.append(("UC7 掌握度", ok))

    # ── UC8: 没分析过的材料 ──────────────────────────────────────
    r = send_tutor_request(
        token, MATERIAL_ID_NO_ANALYSIS,
        "帮我讲讲这个课件",
    )
    ok = print_result("UC8: 无分析材料 — 降级处理", r)
    results.append(("UC8 无分析", ok))

    # ── UC9: 多轮对话上下文 ──────────────────────────────────────
    r = send_tutor_request(
        token, MATERIAL_ID_SQL,
        "你能举个具体的例子吗？比如有 Employee 和 Department 两个表",
        history=conversation_history,  # carries UC1+UC2 context
    )
    ok = print_result("UC9: 多轮上下文 — '举个例子'", r)
    results.append(("UC9 多轮上下文", ok))

    # ── 汇总 ─────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print("📊 测试汇总")
    print(f"{'='*60}")
    total = len(results)
    passed = sum(1 for _, ok in results if ok)
    for name, ok in results:
        status = "✅" if ok else "❌"
        print(f"  {status} {name}")
    print(f"\n  通过: {passed}/{total}")

    if passed < total:
        sys.exit(1)


if __name__ == "__main__":
    main()
