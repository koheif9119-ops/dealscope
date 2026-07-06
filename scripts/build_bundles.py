# -*- coding: utf-8 -*-
"""日次アーカイブ（data/daily/）を月別ファイル（data/monthly/YYYY-MM.json）にまとめる。

過去検索画面は月別ファイルを読み込むため、日次ファイルが何年分に増えても軽く動く。
data/monthly/index.json に存在する月の一覧を書き出す。
"""
import os
import re

from util import DAILY_DIR, DATA_DIR, read_json, write_json

MONTHLY_DIR = os.path.join(DATA_DIR, "monthly")


def rebuild(months=None):
    """月別ファイルを作り直す。months に月の集合（例 {"2026-07"}）を渡すとその月だけ更新。"""
    if not os.path.isdir(DAILY_DIR):
        return
    files = sorted(
        f for f in os.listdir(DAILY_DIR)
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}\.json", f)
    )
    by_month = {}
    for f in files:
        by_month.setdefault(f[:7], []).append(f)

    for month, flist in by_month.items():
        path_exists = os.path.exists(os.path.join(MONTHLY_DIR, month + ".json"))
        # 指定外の月でも、月別ファイルがまだ無ければ作る（さかのぼり取得の後処理）
        if months is not None and month not in months and path_exists:
            continue
        items = []
        for f in flist:
            items += read_json(os.path.join(DAILY_DIR, f), [])
        items.sort(key=lambda x: (x["date"], x["time"], x["id"]), reverse=True)
        path = os.path.join(MONTHLY_DIR, month + ".json")
        if read_json(path, None) != items:
            write_json(path, items)

    all_months = sorted(by_month)
    idx_path = os.path.join(MONTHLY_DIR, "index.json")
    if read_json(idx_path, None) != all_months:
        write_json(idx_path, all_months)


if __name__ == "__main__":
    rebuild()
