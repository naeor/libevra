/**
 * Picking a category from what was said.
 *
 * The owner's request: **"可以再补充一些逻辑，比如说检测到对话食物的时候。如果
 * 分类里有餐饮，就选餐饮等等."**
 *
 * ⚠️ **It only picks a category that already exists, and it says what it matched
 * on.** Both rules come from one concern.
 *
 * **Never invent a category.** The categories belong to the user and they rename
 * them; a guess that created "餐饮" in a ledger whose owner calls it "吃饭" would be
 * the app deciding something that is not its to decide. So this matches against
 * the list it is given and returns `null` when nothing fits — and `null` is a
 * perfectly good answer, because the category field is one tap away.
 *
 * **Never guess silently.** The result carries the words that matched, so the
 * interface can say "听到「午饭」，已选：餐饮" rather than quietly filling a field.
 * The amount is shown for this reason; a silently-chosen category is the same
 * failure in a different field.
 *
 * The vocabularies are made of **words, not fragments**. 「水」 appears in 水果, 水费
 * and 水瓶, so it is never listed on its own; every entry is two characters or more
 * and means the same thing wherever it appears.
 *
 * Evidence comes in tiers, because the owner asked for the food words to carry
 * more weight:
 *
 *  * `words` — the everyday way of naming the activity (吃饭, 打车). One vote.
 *  * `strong` — words that *are* the activity, not an example of it: 午饭, 外卖,
 *    食堂, 火锅. Two votes. A dish is evidence of a meal; a meal name is the
 *    category itself.
 *  * `related` — concrete dishes and foods (炸鸡, 卤肉饭). One vote each: real
 *    evidence, but a dish mentioned in passing must not outvote a sentence that
 *    is really about something else.
 */

/** What the matcher needs to know about a category. */
export interface CategoryCandidate {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly isArchived: boolean;
}

export interface CategoryMatch {
  readonly id: string;
  /** The words that matched, so the interface can show its reasoning. */
  readonly matched: readonly string[];
}

/**
 * The words that suggest each kind of spending, keyed by an internal subject
 * name.
 *
 * ⚠️ **The later argument is `aliases` and the earlier one is not.** The first
 * version tried to derive the subject from the key by substring containment, which
 * cannot work: a category the owner calls 吃饭 is not a substring of the key 餐饮,
 * and neither contains the other. **A subject and its synonyms have no textual
 * relationship**, so the synonyms have to be listed. That is what `aliases` is —
 * the names this subject goes by in somebody's ledger.
 */
interface SubjectVocabulary {
  readonly aliases: readonly string[];
  readonly words: readonly string[];
  /** Names of the activity itself; counted twice. */
  readonly strong?: readonly string[];
  /** Concrete dishes and foods; counted once. */
  readonly related?: readonly string[];
}

const VOCABULARY: Readonly<Record<string, SubjectVocabulary>> = {
  餐饮: {
    aliases: ["餐饮", "吃饭", "吃的", "伙食", "美食", "食物", "食品"],
    /**
     * The words the owner called strong evidence: saying 午饭 or 外卖 is naming
     * the meal, while saying 炸鸡 is naming one thing that was eaten. The nine
     * here are exactly the list he gave; 早饭 and 夜宵 stay in `words` so the
     * tier means "the owner's list", not "a guess at what is common".
     */
    strong: ["午饭", "晚饭", "早餐", "午餐", "晚餐", "外卖", "食堂", "火锅", "烧烤"],
    words: [
      "早饭", "夜宵", "宵夜", "吃饭", "吃了", "吃个", "点餐", "餐厅", "饭店", "饭馆",
      "拉面", "米饭", "面条", "包子", "饺子", "快餐", "奶茶", "咖啡", "饮料", "零食",
      "水果", "买菜", "下馆子",
    ],
    /**
     * ⚠️ The owner's second report: **炸鸡、卤肉饭 这类具体菜名没有进入餐饮联想
     * 词表**. Every entry is two characters or more, so a dish name cannot be
     * mistaken for a single ambiguous character (the 「水」 problem). A dish counts
     * once: it is evidence of a meal, not proof of which category the sentence is
     * about.
     */
    related: [
      "炸鸡", "卤肉饭", "汉堡", "披萨", "米线", "麻辣烫", "螺蛳粉", "便当", "盒饭", "炒饭",
      "盖饭", "寿司", "烤肉", "小龙虾", "串串", "麻辣香锅", "油条", "豆浆", "馒头", "白粥",
      "喝粥", "鸡排", "炸串", "煎饼", "米粉", "馄饨", "工作餐", "加班餐", "下午茶", "年夜饭",
      "料理", "麦当劳", "肯德基", "星巴克", "瑞幸", "蜜雪冰城", "喜茶", "奈雪", "海底捞",
      "必胜客", "汉堡王", "华莱士", "塔斯汀", "茶百道", "古茗", "沪上阿姨", "Uber Eats",
    ],
  },
  交通: {
    aliases: ["交通", "出行", "通勤", "车费", "路费"],
    words: [
      "打车", "出租车", "网约车", "滴滴", "公交", "地铁", "火车", "高铁", "动车", "机票",
      "飞机", "加油", "油费", "停车", "过路费", "高速费", "共享单车", "单车", "车票", "路费",
      "代驾", "公交卡", "交通卡",
    ],
  },
  购物: {
    aliases: ["购物", "买东西", "逛街", "日用", "服饰", "百货"],
    strong: ["超市", "便利店", "商场"],
    words: [
      "网购", "淘宝", "京东", "拼多多", "下单", "衣服", "鞋子", "裤子",
      "包包", "化妆品", "护肤品", "日用品", "洗发水", "纸巾", "快递", "全家",
    ],
  },
  居住: {
    aliases: ["居住", "住房", "房租", "物业", "家电", "家用"],
    words: ["房租", "水电", "水电费", "水费", "电费", "燃气", "天然气", "物业", "取暖", "暖气", "宽带", "网费"],
  },
  通讯: {
    aliases: ["通讯", "话费", "通信", "手机费"],
    words: ["话费", "流量", "手机费", "电话费", "套餐"],
  },
  医疗: {
    aliases: ["医疗", "看病", "医药", "健康"],
    words: ["看病", "医院", "挂号", "买药", "药费", "体检", "牙医", "门诊", "住院", "药店"],
  },
  娱乐: {
    aliases: ["娱乐", "休闲", "玩乐", "爱好"],
    words: ["电影", "游戏", "KTV", "旅游", "门票", "演唱会", "视频会员"],
  },
  教育: {
    aliases: ["教育", "学习", "培训", "书"],
    words: ["学费", "买书", "培训", "课程", "考试", "报名费", "文具"],
  },
  人情: {
    aliases: ["人情", "礼金", "礼物", "社交"],
    words: ["红包", "随礼", "份子钱", "送礼"],
  },
  宠物: {
    aliases: ["宠物", "猫", "狗"],
    words: ["猫粮", "狗粮", "宠物", "兽医", "猫砂"],
  },
};

/** The words that suggest money coming in, with the categories they belong to. */
const INCOME_VOCABULARY: SubjectVocabulary = {
  aliases: ["工资", "薪水", "收入", "奖金", "报销", "退款", "兼职", "外快", "理财", "分红", "利息"],
  words: ["工资", "薪水", "月薪", "奖金", "报销", "退款", "分红", "利息", "收到", "入账", "到账"],
};

/**
 * The **action** that spent the money, keyed by the same subject names as
 * `VOCABULARY`.
 *
 * The owner's rule (2026-10-20): 「打车去食堂」 is a taxi fare, not a meal — the
 * thing that was *paid for* is the action (打车), while 食堂 is only where the
 * trip ended. A word table alone cannot express that: 打车 and 食堂 are both
 * evidence, and 食堂 even counts twice. So actions get a higher weight than
 * ordinary words, and the destination rule below cancels venue names once an
 * action is present.
 *
 * ⚠️ This is not semantic understanding. It is one structural rule — "an action
 * verb outranks a place name, and a place after 去/到/往/回 is a destination" —
 * chosen because it is explainable and testable. A sentence it gets wrong is one
 * the user can correct in one tap, and `matched` shows which words produced the
 * answer.
 */
const ACTIONS: Readonly<Record<string, readonly string[]>> = {
  餐饮: ["吃饭", "吃个", "点餐", "点外卖", "打包", "吃外卖", "下馆子"],
  交通: ["打车", "坐车", "坐地铁", "坐公交", "坐高铁", "坐飞机", "叫车", "开车", "骑车", "加油", "停车"],
  购物: ["网购", "下单", "团购", "逛街"],
  居住: ["交房租", "交水电费", "交电费", "交水费", "交物业费"],
  通讯: ["充话费", "交话费"],
  医疗: ["看病", "买药", "挂号", "体检", "住院", "看牙"],
  娱乐: ["看电影", "玩游戏", "看演出", "旅游"],
  教育: ["报名", "上课", "买书", "交学费"],
};

/**
 * Places that are the **destination** of a trip rather than what the money
 * bought: 「打车去食堂」 is transport, 「点外卖到公司」 is food.
 *
 * Only used when the sentence contains an action word (see `ACTIONS`); without
 * one, a venue name is ordinary evidence — 「食堂 15」 is still a meal.
 */
const VENUE_LIST: readonly string[] = [
  "食堂", "餐厅", "饭店", "饭馆", "公司", "单位", "学校", "机场", "车站",
  "火车站", "地铁站", "超市", "商场", "医院", "药店", "宿舍", "家里", "楼下",
];
const VENUE_WORDS: ReadonlySet<string> = new Set(VENUE_LIST);

const DESTINATION_PATTERN = new RegExp(
  `(?:去|到|往|回)(?:一趟|趟|了|过)?(?:${VENUE_LIST.join("|")})`,
  "g",
);

interface DestinationRange {
  readonly start: number;
  readonly end: number;
}

/** Character ranges of 「去…」「到…」destination phrases. */
function destinationRanges(spoken: string): readonly DestinationRange[] {
  const ranges: DestinationRange[] = [];
  for (const match of spoken.matchAll(DESTINATION_PATTERN)) {
    const start = match.index ?? 0;
    ranges.push({ start, end: start + match[0].length });
  }
  return ranges;
}

/**
 * Whether a category is "about" a subject.
 *
 * Containment in either direction against the subject's **aliases**, which is what
 * makes this work with names nobody anticipated:
 *
 *  * `name.includes(alias)` — a category named 餐饮美食 is about the 餐饮 subject;
 *  * `alias.includes(name)` — a category named 吃 is about it too.
 *
 * The aliases are why a category called 吃饭 matches: 吃饭 is listed as an alias of
 * the food subject, so the containment test has something to succeed against.
 * Deriving the subject from the key instead was the first version's mistake —
 * **a subject and its synonyms have no textual relationship.**
 */
function isAbout(name: string, aliases: readonly string[]): boolean {
  return aliases.some((alias) => name.includes(alias) || alias.includes(name));
}

/**
 * Find the category that fits what was said.
 *
 * Returns `null` when nothing matches — treat that as "leave it to the user", not
 * as a failure.
 */
export function matchCategory(
  spoken: string,
  categories: readonly CategoryCandidate[],
  kind: "expense" | "income",
): CategoryMatch | null {
  if (spoken.trim() === "") return null;

  /**
   * Only categories of the right kind.
   *
   * The API refuses a category whose kind disagrees with the entry — "「转账」属于
   * 收入分类，和这笔记账的收支类型不一致" — so offering one would produce a rejection
   * the user cannot explain.
   */
  const usable = categories.filter(
    (category) => category.kind === kind && !category.isArchived && category.name.trim() !== "",
  );

  if (usable.length === 0) return null;

  /**
   * The vocabularies to search, worked out once.
   *
   * For spending, every heading in the table — each is filtered per category by
   * whether the category is about it. For income, the income words **and** every
   * heading: somebody whose category is called 工资 must still match the word
   * 工资, and somebody whose income category is called 兼职 should still match
   * 报销 because 报销 is what they said. Doing it as a list rather than as nested
   * conditions is what stopped the first version from silently searching nothing
   * in the income case.
   */
  /**
   * The vocabularies to search, worked out once.
   *
   * For spending: every subject, each filtered per category by whether the
   * category is about it. For income: the income subject as well, so that 工资 and
   * 报销 are reachable whichever an income category is named after.
   */
  const subjects: readonly (readonly [string, SubjectVocabulary])[] =
    kind === "income"
      ? [...Object.entries(VOCABULARY), ["收入", INCOME_VOCABULARY] as const]
      : Object.entries(VOCABULARY);

  /**
   * Whether the sentence carries an action word at all. The destination rule
   * only applies then: 「食堂」 alone must stay evidence.
   */
  const hasAction = subjects.some(([subjectName]) =>
    (ACTIONS[subjectName] ?? []).some((word) => spoken.includes(word)),
  );
  const destinations = hasAction ? destinationRanges(spoken) : [];

  const inDestination = (index: number): boolean =>
    destinations.some((range) => index >= range.start && index < range.end);

  let best: {
    readonly match: CategoryMatch;
    readonly score: number;
    readonly firstAction: number;
  } | null = null;

  for (const category of usable) {
    const evidence = new Map<string, number>();
    let score = 0;
    let firstAction = Number.POSITIVE_INFINITY;

    const vote = (word: string, weight: number): void => {
      // Vote once per word, at its highest weight: an action word such as 打车 is
      // also in `words`, and counting it twice would double a single statement.
      if (evidence.has(word)) return;

      let count = 0;
      let at = spoken.indexOf(word);

      while (at !== -1) {
        // A venue after 去/到/往/回 is where the trip ended, not what was bought.
        if (!(VENUE_WORDS.has(word) && inDestination(at))) count += 1;
        at = spoken.indexOf(word, at + word.length);
      }

      if (count > 0) {
        evidence.set(word, count);
        score += count * weight;
      }
    };

    for (const [subjectName, subject] of subjects) {
      // Only a category that is *about* this subject votes on its words.
      if (!isAbout(category.name, subject.aliases)) continue;

      for (const word of ACTIONS[subjectName] ?? []) {
        if (spoken.includes(word)) {
          firstAction = Math.min(firstAction, spoken.indexOf(word));
        }
        vote(word, 3);
      }
      for (const word of subject.strong ?? []) vote(word, 2);
      for (const word of subject.words) vote(word, 1);
      for (const word of subject.related ?? []) vote(word, 1);
    }

    // The category's own name, said out loud: "餐饮三十八". Counted as two votes,
    // because hearing the category named is the strongest evidence there is.
    if (category.name.length >= 2 && spoken.includes(category.name)) {
      evidence.set(category.name, (evidence.get(category.name) ?? 0) + 2);
      score += 2;
    }

    /**
     * Ties go to the **earlier action**: 「打车去吃饭」 is a taxi fare that paid
     * for the ride, and the action said first is the one the amount belongs to.
     */
    if (
      score > 0 &&
      (best === null ||
        score > best.score ||
        (score === best.score && firstAction < best.firstAction))
    ) {
      best = { match: { id: category.id, matched: [...evidence.keys()] }, score, firstAction };
    }
  }

  return best?.match ?? null;
}
