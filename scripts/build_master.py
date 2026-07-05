# -*- coding: utf-8 -*-
"""市場区分マスタ（証券コード→プライム/スタンダード/グロース）を生成する。

JPX「東証上場銘柄一覧」（月次更新のExcel）をダウンロードして
data/master/markets.json を作る（仕様書2-4）。

東証以外（名・札・福）の単独上場銘柄はこのマスタには載らないため、
TDnet側の取引所情報から「地方」として扱う（classify.resolve_market参照）。
"""
import re

import xlrd

from util import MASTER_PATH, polite_get, write_json

PAGE_URL = "https://www.jpx.co.jp/markets/statistics-equities/misc/01.html"


def main():
    html = polite_get(PAGE_URL).decode("utf-8", "replace")
    m = re.search(r'href="([^"]*data_j[^"]*\.xlsx?)"', html)
    if not m:
        raise RuntimeError("JPXのページから銘柄一覧Excelのリンクが見つかりませんでした")
    url = m.group(1)
    if url.startswith("/"):
        url = "https://www.jpx.co.jp" + url

    book = xlrd.open_workbook(file_contents=polite_get(url, timeout=120))
    sheet = book.sheet_by_index(0)
    header = [str(c.value).strip() for c in sheet.row(0)]
    code_i = header.index("コード")
    seg_i = header.index("市場・商品区分")
    ind_i = header.index("33業種区分") if "33業種区分" in header else -1

    master = {}
    for r in range(1, sheet.nrows):
        raw = sheet.cell_value(r, code_i)
        code = str(int(raw)) if isinstance(raw, float) else str(raw).strip()
        seg = str(sheet.cell_value(r, seg_i))
        if "プライム" in seg:
            market = "プライム"
        elif "スタンダード" in seg:
            market = "スタンダード"
        elif "グロース" in seg:
            market = "グロース"
        else:
            continue  # ETF・REIT・PRO Market等は対象外
        industry = ""
        if ind_i >= 0:
            industry = str(sheet.cell_value(r, ind_i)).strip()
            if industry == "-":
                industry = ""
        master[code[:4]] = {"market": market, "exch": "東", "industry": industry}

    write_json(MASTER_PATH, master, sort_keys=True)
    print(f"markets.json を更新しました（{len(master)}銘柄）")


if __name__ == "__main__":
    main()
