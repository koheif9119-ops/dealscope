# -*- coding: utf-8 -*-
"""定期実行の入口。取得 → 分類 → 既存JSONとマージ（重複排除） → latest.json 再構築。

変更がなければファイルを書き換えない（＝ワークフロー側でコミットされない）。
"""
import os
from datetime import datetime, timedelta

import build_master
import classify
import fetch_edinet
import fetch_prtimes
import fetch_tdnet
from util import DAILY_DIR, JST, LATEST_PATH, MASTER_PATH, read_json, write_json


def daily_path(day_iso):
    return os.path.join(DAILY_DIR, day_iso + ".json")


def main():
    keywords = classify.load_keywords()

    # 市場区分マスタが無ければ先に作る（失敗しても取得は続行）
    if not os.path.exists(MASTER_PATH):
        try:
            build_master.main()
        except Exception as e:  # noqa: BLE001
            print("市場区分マスタの作成に失敗（続行します）:", e)
    master = read_json(MASTER_PATH, {})

    today = datetime.now(JST).date()
    has_history = os.path.isdir(DAILY_DIR) and any(
        f.endswith(".json") for f in os.listdir(DAILY_DIR)
    )
    # 初回はさかのぼって5日分、通常は昨日と今日の2日分を取得する
    back = 4 if not has_history else 1
    dates = [today - timedelta(days=i) for i in range(back, -1, -1)]

    items = []

    for d in dates:
        try:
            items += fetch_tdnet.fetch_day(d.strftime("%Y%m%d"))
        except Exception as e:  # noqa: BLE001
            print(f"TDnet取得失敗 {d}:", e)

    api_key = os.environ.get("EDINET_API_KEY", "").strip()
    if api_key:
        # 前営業日〜当日をカバーするため直近4日分（初回は5日分）
        edinet_dates = dates if not has_history else [
            today - timedelta(days=i) for i in range(3, -1, -1)
        ]
        for d in edinet_dates:
            try:
                items += fetch_edinet.fetch_day(d.isoformat(), api_key)
            except Exception as e:  # noqa: BLE001
                print(f"EDINET取得失敗 {d}:", e)
    else:
        print("EDINET_API_KEY が未設定のため、EDINETの取得をスキップしました")

    try:
        items += fetch_prtimes.fetch(keywords.get("prtimes", []))
    except Exception as e:  # noqa: BLE001
        print("PR TIMES取得失敗:", e)

    # ---- 分類（仕様書3）----
    kept = []
    for it in items:
        if it["src"] == "TDnet":
            genre, tags = classify.classify_title(it["title"], keywords)
            if genre is None:
                continue  # 対象外の開示（配当予想・人事など）は保存しない
            it["genre"], it["tags"] = genre, tags
        elif it["src"] == "EDINET":
            _, tags = classify.classify_title(it["title"], keywords)
            it["genre"] = "kessan"
            it["tags"] = tags or ["有価証券報告書"]
        it["isCorrection"] = "訂正" in it["title"]
        classify.resolve_market(it, master)
        kept.append(it)

    # ---- 日次アーカイブへマージ（重複排除）----
    by_day = {}
    for it in kept:
        by_day.setdefault(it["date"], []).append(it)

    added = 0
    for day, new_list in sorted(by_day.items()):
        path = daily_path(day)
        old = read_json(path, [])
        ids = {x["id"] for x in old}
        sigs = {(x["date"], x["code"], x["title"]) for x in old}
        merged = list(old)
        for it in new_list:
            if it["id"] in ids or (it["date"], it["code"], it["title"]) in sigs:
                continue
            ids.add(it["id"])
            sigs.add((it["date"], it["code"], it["title"]))
            merged.append(it)
            added += 1
        merged.sort(key=lambda x: (x["time"], x["id"]), reverse=True)
        if merged != old:
            write_json(path, merged)

    # ---- latest.json（直近7日分）を再構築 ----
    window = [(today - timedelta(days=i)).isoformat() for i in range(6, -1, -1)]
    all_items = []
    for day in window:
        all_items += read_json(daily_path(day), [])
    all_items.sort(key=lambda x: (x["date"], x["time"], x["id"]), reverse=True)

    old_latest = read_json(LATEST_PATH, {})
    if old_latest.get("items") != all_items:
        write_json(LATEST_PATH, {
            "updatedAt": datetime.now(JST).strftime("%Y-%m-%dT%H:%M:%S+09:00"),
            "items": all_items,
        })
        print(f"latest.json を更新しました（新規{added}件／合計{len(all_items)}件）")
    else:
        print("新規の開示はありませんでした（コミットなし）")


if __name__ == "__main__":
    main()
