# -*- coding: utf-8 -*-
"""過去の開示（TDnet）をさかのぼって取得し、日次アーカイブに追加する。

- 取得済みの日は飛ばすので、途中で止まっても再実行すれば続きから進む。
- 実行時間の目安：365日分で15分程度（アクセスマナーの1秒間隔を守るため）。
"""
import os
import sys
from datetime import datetime, timedelta

import classify
import fetch_tdnet
from util import DAILY_DIR, JST, MASTER_PATH, read_json, write_json


def main(days=365):
    keywords = classify.load_keywords()
    master = read_json(MASTER_PATH, {})
    today = datetime.now(JST).date()

    done = 0
    for i in range(days, 0, -1):
        day = today - timedelta(days=i)
        path = os.path.join(DAILY_DIR, day.isoformat() + ".json")
        if os.path.exists(path):
            continue  # 取得済み（再実行しても安全）

        kept = []
        try:
            for it in fetch_tdnet.fetch_day(day.strftime("%Y%m%d")):
                genre, tags = classify.classify_title(it["title"], keywords)
                if genre is None:
                    continue
                it["genre"], it["tags"] = genre, tags
                it["isCorrection"] = "訂正" in it["title"]
                classify.resolve_market(it, master)
                kept.append(it)
        except Exception as e:  # noqa: BLE001
            print("取得失敗（次回の実行で再挑戦します）", day, e)
            continue

        kept.sort(key=lambda x: (x["time"], x["id"]), reverse=True)
        write_json(path, kept)
        done += 1
        if done % 30 == 0:
            print(f"{day} まで取得完了")

    # 月別まとめ（monthly）はここでは作らない。
    # 通常の定期取得（run_fetch）と同じファイルを触って保存が衝突するのを防ぐため、
    # 次回の定期取得が不足している月ぶんを自動で作る。
    print(f"さかのぼり取得が完了しました（新規{done}日分）")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 365)
