# tasks

## 已完成

- [x] 确认当前 Mastra 版本已包含 `channels` 能力，并核对本地内嵌文档
- [x] 梳理当前仓库 agent、入口注册、存储与鉴权现状
- [x] 调研 Discord 接入所需的 Mastra `channels`、webhook、gateway、thread context 与 tool/card 行为
- [x] 形成实现前提案并记录推荐方案、影响范围与风险
- [x] 用户已确认首期接入对象为 `travelAgent`
- [x] 用户已确认首期目标为跑通 Discord 并正常对话
- [x] 用户已确认首期需要支持图片附件输入
- [x] 用户已确认需要为未来 JWT 恢复预留口子
- [x] 用户已确认说明文档需要一并补齐

## 待确认

- [ ] 用户显式确认现在进入 Apply 阶段

## 实施任务（确认后执行）

- [ ] 安装 Discord 适配器依赖并补充环境变量说明
- [ ] 为 `travelAgent` 增加 `channels.discord`、DM / `@mention` 和图片输入配置
- [ ] 根据部署形态确认 `gateway`、`cards`、`threadContext` 配置
- [ ] 为未来 JWT 恢复预留 Discord webhook 公共路径白名单扩展点
- [ ] 更新 README 与联调文档，记录 Discord 配置与 webhook 地址
- [ ] 运行 `npm run build` 验证编译通过

## 进入 Apply 的条件

- [x] 用户已确认使用 `travelAgent`
- [x] 用户已确认首期目标为跑通 Discord 并正常对话
- [x] 用户已确认首期需要支持图片附件
- [x] 用户已确认需要为 JWT 恢复预留口子
- [x] 用户已确认说明文档需要一并补齐
- [ ] 用户显式确认现在进入 Apply
