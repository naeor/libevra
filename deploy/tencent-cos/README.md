# S13-I 腾讯云隔离测试材料（未执行）

本目录只含**准备材料**，当前没有任何云端资源被创建或修改：

- [CAM 控制台操作指南](./CAM_CONSOLE_SETUP.md)
- [测试写身份策略](./s13i-test-write-policy.json)
- [测试读身份策略](./s13i-test-read-policy.json)
- [真实 COS + Docker 演练计划](./TEST_DRILL_PLAN.md)

策略中的真实桶/appid/地域来自生产只读检查，但**尚未由 CAM 控制台验证**。执行前必须由所有者批准，并逐项验证权限边界；若 `cos:prefix` 条件或显式 deny 无法按预期工作，不要扩大权限，先汇报。

不得把 SecretId/SecretKey/事件密钥或生产恢复口令放入本目录。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [CAM_CONSOLE_SETUP.md](CAM_CONSOLE_SETUP.md) | S13-I 腾讯云 CAM 隔离测试指南（仅准备，尚未执行） |
| [TEST_DRILL_PLAN.md](TEST_DRILL_PLAN.md) | S13-I 真实 COS + Docker 隔离演练执行计划（待批准，尚未执行） |
| [s13i-test-read-policy.json](s13i-test-read-policy.json) | 结构化配置、资源或夹具 |
| [s13i-test-write-policy.json](s13i-test-write-policy.json) | 结构化配置、资源或夹具 |
<!-- directory-index:end -->
