# -*- coding: utf-8 -*-
"""TDnetの省略社名（例「Ｇ－ベストワンドット」）を正式社名に置き換える。

正式社名の情報源（優先順）:
1. EDINETの有報対照表（yuho_index.json）の提出者名 —「株式会社〜」付きの正式名
2. JPX銘柄一覧（markets.json）の銘柄名

毎回の定期取得の最後に実行され、過去分も含めて常に正式社名に保たれる。
"""
import os

import build_bundles
from util import DAILY_DIR, DATA_DIR, LATEST_PATH, MASTER_PATH, read_json, write_json

INDEX_PATH = os.path.join(DATA_DIR, "master", "yuho_index.json")


def name_map():
    names = {}
    for code, info in read_json(MASTER_PATH, {}).items():
        if info.get("name"):
            names[code] = info["name"]
    # EDINETの正式社名（株式会社〜付き）で上書き
    for code, entry in read_json(INDEX_PATH, {}).get("codes", {}).items():
        if entry.get("name"):
            names[code] = entry["name"]
    return names


def fix_items(items, names):
    changed = False
    for it in items:
        if it.get("src") == "PR TIMES":
            continue
        official = names.get(it.get("code", ""))
        if official and it.get("name") != official:
            it["name"] = official
            changed = True
    return changed


def main():
    names = name_map()
    if not names:
        print("正式社名の対照表がまだ無いためスキップしました")
        return

    touched_months = set()
    if os.path.isdir(DAILY_DIR):
        for f in sorted(os.listdir(DAILY_DIR)):
            if not f.endswith(".json"):
                continue
            path = os.path.join(DAILY_DIR, f)
            items = read_json(path, [])
            if fix_items(items, names):
                write_json(path, items)
                touched_months.add(f[:7])

    if touched_months:
        build_bundles.rebuild(months=touched_months)

    latest = read_json(LATEST_PATH, {})
    if fix_items(latest.get("items", []), names):
        write_json(LATEST_PATH, latest)

    print(f"正式社名への置き換え完了（{len(touched_months)}か月分のファイルを更新）")


if __name__ == "__main__":
    main()
