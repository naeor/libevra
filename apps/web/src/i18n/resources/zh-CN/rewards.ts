/**
 * 奖励相关的全局文案（S16 头像奖励系统）。
 *
 * 放在独立命名空间而不是 `account` 下，是因为通知条出现在底部导航上方，
 * 与「我的」页面无关；两个地方共用同一个名字，阅读时就不用猜。
 */
export const rewards = {
  banner: {
    singleTitle: "获得新头像 · {{name}}",
    singleBody: "已收入头像收藏",
    multipleTitle: "已获得 {{count}} 款纪念头像",
    multipleBody: "均已收入头像收藏",
    cta: "查看头像收藏",
    dismiss: "关闭通知",
  },
};

export default rewards;
