# 真实汇率样本（2026-10-26）

> 最后核对: `535419c` / 2026-10-26

`requests.json` 保存本轮 15 次公开 GET 的 URL、HTTP 状态、耗时及原始响应，无账号、账本、真实交易或凭据。数据源为 [Frankfurter](https://frankfurter.dev/)，单一 ECB 数据须遵守 [ECB 使用条款](https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html)。`ecb-official` 是 ECB Data API 同日五币种原始 CSV；`blended` 仅用于比较来源差异，不进入应用数据源。外币数值来源为 ECB，经 Frankfurter 转发；跨币种计算是本项目派生结果，不是银行结算报价。

`oracle.json` 是 `prepare-real-oracle.py` 以 Python Decimal（80 位精度、ROUND_HALF_UP）从响应原文独立生成的 108 组 EUR 桥接参照，不使用 JavaScript 浮点金额计算。其 `usdBaseComparisons` 保留直接 USD 报价的有限小数与交叉精确比值之间的误差界，不能把直接报价当作无限精度数学真值。

除这 15 条落盘记录，本轮第一次显式适配器联网尝试触发过默认 5 秒超时，未得到 HTTP 状态，初版采集器在异常退出前未落盘；该次只能以本轮终端异常为证，不能伪造响应。后续同一地址实际返回 200；采集器已修复为记录失败、继续保存，并以非零退出码报告适配器失败。

样本回归测试默认不联网；只有显式运行 `live-check.ts --live` 才会重新查询。原始采样不代表所有币种、日期连续有覆盖。完整结论见[真实验证报告](../../../../../../docs/archive/releases/S16-D-真实汇率验证与集成前验收-20261026.md)。
