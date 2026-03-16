/**
 * Socratic dialogue response templates — organized by scaffold level.
 * Extracted from SocraticChat to keep the component file under 400 lines.
 */

export interface ResponseTemplate {
  content: (userMessage: string, moduleName: string) => string
  hint?: (moduleName: string) => string
  hasReveal?: boolean
}

export const fullTemplates: ResponseTemplate[] = [
  {
    content: (_msg, mod) =>
      `好问题！让我帮你一步步理清"${mod}"中的这个概念。\n\n首先，你觉得这个概念的核心定义是什么？试着用自己的话描述一下——不需要完美，只需要捕捉到你目前的理解。`,
    hint: (mod) => `提示：回忆一下课件中第一次引入这个术语的地方。它在"${mod}"里解决了什么问题？`,
    hasReveal: true,
  },
  {
    content: (_msg, mod) =>
      `别着急，我们慢慢来。学习"${mod}"这部分内容时，最重要的是建立直觉。\n\n让我给你一个具体的场景：想象你需要向一个朋友解释这个概念，你会从哪里开始？先说说你已经知道的部分。`,
    hint: (mod) => `提示：试着把"${mod}"中的这个概念和你日常生活中的某个类比联系起来。抽象概念往往可以用具体例子来理解。`,
    hasReveal: true,
  },
  {
    content: (msg, mod) =>
      `关于"${msg.slice(0, 15)}…"这个问题，我注意到它涉及到"${mod}"中一个很基础的概念。\n\n让我们先打好地基：这个概念的**前置知识**是什么？你觉得要理解它，首先需要知道哪些东西？`,
    hint: (mod) => `提示：在"${mod}"的课件结构中，这个概念之前讲了什么？那些内容就是前置知识。`,
    hasReveal: true,
  },
  {
    content: (_msg, mod) =>
      `这是"${mod}"中很多同学都会困惑的点，你不是一个人！\n\n我们换一种方式来思考：如果我告诉你这个概念不存在，"${mod}"会缺少什么？它在整个知识体系中扮演什么角色？\n\n从"为什么需要它"出发，往往比"它是什么"更容易理解。`,
    hasReveal: false,
  },
  {
    content: (msg) =>
      `你提到了"${msg.slice(0, 20)}"——这个方向很好。让我引导你更深入一点。\n\n现在，试着把这个概念分成两到三个更小的部分。哪一部分你已经理解了？哪一部分还模糊？\n\n把模糊的部分说出来，我们逐个击破。`,
    hint: () => `提示：很多复杂概念其实是由几个简单想法组合而成的。试着识别出这些"积木块"。`,
    hasReveal: true,
  },
]

export const moderateTemplates: ResponseTemplate[] = [
  {
    content: (msg) =>
      `关于"${msg.slice(0, 20)}"，你能想到哪些相关的概念？它们之间有什么联系？\n\n试着画一个简单的关系图——哪些概念是前提，哪些是推论？`,
    hasReveal: true,
  },
  {
    content: (_msg, mod) =>
      `你已经有不错的基础了。想想看，这个问题的关键在于什么？\n\n更具体地说：如果你要用一句话总结"${mod}"中这个概念的本质，你会怎么说？`,
    hasReveal: true,
  },
  {
    content: (_msg, mod) =>
      `试着从另一个角度思考：如果这个条件改变了，结果会怎样？\n\n这种"假设性思考"是深入理解"${mod}"概念的关键——它帮你区分"记住了"和"真正理解了"。`,
    hasReveal: false,
  },
  {
    content: (msg, mod) =>
      `有趣的问题。在"${mod}"中，"${msg.slice(0, 15)}"其实和另一个概念有很深的联系。\n\n你能猜到是哪个吗？提示：它们经常一起出现在考题中。`,
    hasReveal: true,
  },
  {
    content: (_msg, mod) =>
      `你的理解方向是对的。现在让我们更进一步——\n\n在"${mod}"中，这个概念有没有什么常见的误解或易混淆的点？你之前学习时有没有踩过这样的坑？`,
    hasReveal: false,
  },
  {
    content: (_msg, mod) =>
      `不错的思考！让我追问一个问题：这个概念在"${mod}"中的**应用场景**是什么？\n\n能举一个你见过的具体例子吗？如果想不到，我可以给你一个场景来分析。`,
    hint: () => `提示：回想一下课后习题或往年考题中，这个概念是怎么被考查的。`,
    hasReveal: true,
  },
  {
    content: (msg) =>
      `"${msg.slice(0, 20)}"——你提到的这一点很重要。\n\n现在，如果我说你的理解只对了一半，你觉得可能遗漏了什么？这不是在否定你，而是帮你找到理解的边界。`,
    hasReveal: false,
  },
]

export const minimalTemplates: ResponseTemplate[] = [
  {
    content: (_msg, mod) =>
      `很好，你对这个已经相当熟悉了。那么，你能解释为什么"${mod}"中采用这种方法而不是其他方案吗？\n\n从**设计动机**的角度来思考。`,
  },
  {
    content: () =>
      `你能构造一个**反例**来测试你的理解吗？或者说，在什么边界条件下这个结论不再成立？\n\n能找到边界的人，才是真正理解了这个概念。`,
  },
  {
    content: () =>
      `试着向一个完全不了解这个领域的人解释这个概念。要求：不使用任何专业术语，只用日常用语。\n\n费曼说过："如果你不能用简单语言解释，说明你还没真正理解。"`,
  },
  {
    content: (_msg, mod) =>
      `这个问题你已经掌握得很好了。让我给你一个更高阶的挑战：\n\n"${mod}"中的这个概念和其他学科有什么交叉点？它在更广泛的知识体系中处于什么位置？`,
  },
  {
    content: (_msg, mod) =>
      `你准备好接受一个压力测试了吗？\n\n假设考试中出现了一道结合"${mod}"多个概念的综合题，你会如何拆解它？先描述你的解题策略。`,
  },
  {
    content: () =>
      `既然你对这个概念已经很熟了，让我们做一个思想实验——\n\n如果要**改进**或**扩展**这个理论/方法，你觉得最有可能的方向是什么？哪些是它当前的局限性？`,
  },
  {
    content: (msg) =>
      `关于"${msg.slice(0, 15)}"——你的理解已经很到位了。\n\n最后一个挑战：你能提出一个关于这个概念的**好问题**吗？一个你认为大多数同学答不上来的问题。能出好题的人，理解一定最深。`,
  },
]

export const encouragements = [
  '你的思路很清晰！',
  '这个角度很有启发性。',
  '很好的观察！',
  '你正在接近核心了。',
  '这说明你的理解在加深。',
]

export const followUps = [
  '\n\n还有什么想继续探讨的吗？',
  '\n\n如果这个方向感觉对了，我们可以继续深入。',
  '\n\n你可以接着这个思路再展开一下。',
  '',
  '',
]
