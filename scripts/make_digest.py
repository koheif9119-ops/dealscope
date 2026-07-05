# -*- coding: utf-8 -*-
"""朝のダイジェスト（新着のM&A・中期経営計画の一覧）をMarkdownで標準出力に書く。

月曜は金・土・日をまとめてカバーする。新着がなければ何も出力しない
（ワークフロー側で「出力が空なら投稿しない」ようにしている）。
"""
import os
from datetime import datetime, timedelta

from util import DAILY_DIR, JST, read_json

MENTION = "@koheif9119-ops"
GENRE_MARK = {"ma": "🔴 M&A", "chukei": "🟡 中計"}


def main():
    today = datetime.now(JST).date()
    back = 3 if today.weekday() == 0 else 1  # 月曜は3日ぶん（金土日）
    days = [today - timedelta(days=i) for i in range(back, -1, -1)]

    rows = []
    for d in days:
        for it in read_json(os.path.join(DAILY_DIR, d.isoformat() + ".json"), []):
            if it.get("genre") in GENRE_MARK:
                rows.append(it)

    if not rows:
        return

    rows.sort(key=lambda x: (x["date"], x["time"]), reverse=True)
    lines = [
        f"{MENTION} 新着 **{len(rows)}件**（{days[0].strftime('%m/%d')}〜{days[-1].strftime('%m/%d')}）",
        "",
    ]
    for it in rows[:50]:
        mark = GENRE_MARK.get(it["genre"], "")
        title = f"[{it['title']}]({it['pdfUrl']})" if it.get("pdfUrl") else it["title"]
        code = it["code"] if it["code"] != "—" else ""
        lines.append(f"- {mark}｜{it['date'][5:].replace('-', '/')} {it['time']}｜{code} {it['name']}（{it.get('market', '')}）｜{title}")
    if len(rows) > 50:
        lines.append(f"- …ほか{len(rows) - 50}件（サイトで確認 → https://koheif9119-ops.github.io/dealscope/ ）")

    print("\n".join(lines))


if __name__ == "__main__":
    main()
