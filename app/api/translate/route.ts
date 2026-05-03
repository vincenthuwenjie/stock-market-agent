import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const cache = new Map<string, string>();

function decodeEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

const POST_TRANSLATE_ZH: Array<[RegExp, string]> = [
  [/https?:\/\/\S+/g, ""],
  [/<[^>]*>/g, " "],
  [/\bCitrini\b/g, "西特里尼"],
  [/\blitellm\b/gi, "litellm"],
  [/\bPyPI\b/g, "Python 软件包仓库"],
  [/\bpip install\b/gi, "pip 安装"],
  [/\bSSH\b/g, "SSH"],
  [/\bAWS\b/g, "亚马逊云"],
  [/\bGCP\b/g, "谷歌云"],
  [/\bAzure\b/g, "微软云"],
  [/\bKubernetes\b/g, "容器编排配置"],
  [/\bgit\b/gi, "代码仓库"],
  [/\bAPI\b/g, "接口"],
  [/\bshell\b/gi, "命令行"],
  [/\bNative USDC\b/g, "原生 USDC"],
  [/\bNative\b/g, "原生"],
  [/\bJessie Ware\b/g, "杰西·韦尔"],
  [/\bBill Ackman\b/g, "比尔·阿克曼"],
  [/\bDev Kantasaria\b/g, "德夫·坎塔萨里亚"],
  [/\bChris Hohn\b/g, "克里斯·霍恩"],
  [/\bDMR\b/g, "DMR"],
  [/\bCBOE\b/g, "芝加哥期权交易所"],
  [/\bYahoo Finance\b/g, "雅虎财经"],
  [/\bCaterpillar\b/g, "卡特彼勒"],
  [/\bVernova\b/g, "维尔诺瓦"],
  [/\bGeneral Mills\b/g, "通用磨坊"],
  [/\bConagra\b/g, "康尼格拉"],
  [/\bSandisk\b/gi, "闪迪"],
  [/\bTwilio\b/g, "特维里奥"],
  [/\bNathan Peterson\b/g, "内森·彼得森"],
  [/\bIBES\b/g, "IBES"],
  [/\bAlphabet Inc\./g, "谷歌母公司"],
  [/\bAlphabet\b/g, "谷歌母公司"],
  [/\bMagnificent\b/g, "七巨头"],
  [/\bRaymond James\b/g, "雷蒙德詹姆斯"],
  [/\bDRIV Global\b/g, "DRIV 环球"],
  [/\bPlatforms, Inc\./g, "平台公司"],
  [/\bMeta Platforms, Inc\./g, "Meta 平台公司"],
  [/\bCathie Wood\b/g, "凯茜·伍德"],
  [/\bAdvanced Micro Devices\b/g, "超威半导体"],
  [/\bARK Invest\b/g, "方舟投资"],
  [/\bStifel\b/g, "斯蒂费尔"],
  [/\bGAAP\b/g, "通用会计准则"],
  [/\bGPU\b/g, "图形处理器"],
  [/\bTrumpRx\b/g, "特朗普药品平台"],
  [/\bCost Plus Drugs\b/g, "平价药房"],
  [/\bRoblox\b/g, "罗布乐思"],
  [/\bNvidia\b/g, "英伟达"],
  [/\bNVIDIA\b/g, "英伟达"],
  [/\bOklo\b/g, "奥克洛"],
  [/\bSpaceX\b/g, "太空探索技术公司"],
  [/\bIPO\b/g, "首次公开募股"],
  [/\bLANL\b/g, "洛斯阿拉莫斯国家实验室"],
  [/\bElon Musk\b/g, "埃隆·马斯克"],
  [/\bRobotaxi\b/g, "机器人出租车"],
  [/\bWaymo\b/g, "威摩"],
  [/Cyber[\u200B-\u200D\uFEFF\s]*cab/gi, "机器人出租车"],
  [/\bCybercab\b/g, "机器人出租车"],
  [/\bElectrek\b/g, "电动车媒体"],
  [/\bOpenAI\b/g, "开放人工智能公司"],
  [/\bSam Altman\b/g, "山姆·奥尔特曼"],
  [/\bFDIS\b/g, "FDIS"],
  [/\bJim Cramer\b/g, "吉姆·克莱默"],
  [/\bCanaccord Genuity\b/g, "加拿科德杰纽迪投行"],
  [/\bRivian\b/g, "瑞维安"],
  [/\bUnusual Whales\b/g, "异动鲸鱼"],
  [/\bZeroHedge\b/g, "零对冲"],
  [/\bTraderS\b/g, "缺德道人"],
  [/\bTALK\b/g, "谈话"],
  [/\bsell the rip\b/gi, "逢高卖出"],
  [/\bbuy the dip\b/gi, "逢低买入"],
  [/\bMove on\b/gi, "继续往前走"],
  [/\bcoin\b/gi, "代币"],
  [/\bRay Dalio\b/g, "瑞·达利欧"],
  [/\bChamath Palihapitiya\b/g, "查马斯·帕里哈皮蒂亚"],
  [/\bAndrej Karpathy\b/g, "安德烈·卡帕西"],
  [/\bBalder\b/g, "巴尔德"],
  [/\bSpirit Airlines\b/g, "精神航空"],
  [/\bSpirit\b/g, "精神航空"],
  [/\bGLP-1s\b/g, "减重药物"],
  [/\bGLP-1\b/g, "减重药物"],
  [/\bNetflix\b/g, "奈飞"],
  [/\bBeef\b/g, "《怒呛人生》"],
  [/\bKen Griffin\b/g, "肯·格里芬"],
  [/\bZohran Mamdani\b/g, "佐赫兰·马姆达尼"],
  [/\bSocial Security\b/g, "社会保障"],
  [/\bS&P 500\b/g, "标普 500"],
  [/\bETF(s)?\b/g, "交易所交易基金"],
  [/\bNasdaqGS\b/g, "纳斯达克"],
  [/\bNASDAQ\b/g, "纳斯达克"],
  [/\bNasdaq\b/g, "纳斯达克"],
  [/纳斯达克GS/g, "纳斯达克"],
  [/\bFed\b/g, "美联储"],
  [/\bCEO\b/g, "首席执行官"],
  [/\biPhone\b/g, "苹果手机"],
  [/\biPad\b/g, "苹果平板"],
  [/\bMac\b/g, "苹果电脑"],
  [/\bRAMgeddon\b/g, "内存灾难"],
  [/\bKevan Parekh\b/g, "凯万·帕雷克"],
  [/\bGeico\b/g, "盖可保险"],
  [/\bBNSF\b/g, "伯灵顿北方圣太菲铁路"],
  [/\bDairy Queen\b/g, "冰雪皇后"],
  [/\bSee's Candies\b/g, "喜诗糖果"],
  [/\bInvesting\.com\b/g, "英为财情"],
  [/\bTom Steyer\b/g, "汤姆·斯泰尔"],
  [/\bRivian Automotive Inc\./g, "瑞维安汽车公司"],
  [/\bAutomotive Inc\./g, "汽车公司"],
  [/\bJim Chanos\b/g, "吉姆·查诺斯"],
  [/\bScaringe\b/g, "斯卡林格"],
  [/\bCyber cab\b/gi, "机器人出租车"],
  [/\bCybercab\b/g, "机器人出租车"],
  [/\bRDDT\b/g, "RDDT"],
  [/\bCipher Digital\b/g, "赛弗数字公司"],
  [/\bCIFR\b/g, "CIFR"],
  [/\bReddit\b/g, "红迪"],
  [/\bPivotal Research\b/g, "关键研究公司"],
  [/\bNYSE\b/g, "纽约证券交易所"],
  [/\bGLW\b/g, "GLW"],
  [/\beVTOL\b/g, "电动垂直起降飞行器"],
  [/\bRye\b/g, "莱伊"],
  [/\bdiscussed the firm\b/gi, "讨论了该公司"],
  [/\bdiscussed\b/gi, "讨论了"],
  [/\bthe firm\b/gi, "该公司"],
  [/\bCT\b/g, "CT"],
  [/\bAI\b/g, "人工智能"],
];

function postProcessChinese(value: string) {
  let text = value;
  for (const [pattern, replacement] of POST_TRANSLATE_ZH) text = text.replace(pattern, replacement);
  return text.replace(/\s+/g, " ").trim();
}

async function translateOne(value: string) {
  const text = decodeEntities(value)
    .replace(/https?:\/\/\S+/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const cached = cache.get(text);
  if (cached) return cached;

  const params = new URLSearchParams({
    client: "gtx",
    sl: "auto",
    tl: "zh-CN",
    dt: "t",
    q: text,
  });
  const response = await fetch(`https://translate.googleapis.com/translate_a/single?${params.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`translate ${response.status}`);
  const payload = await response.json() as Array<unknown>;
  const translated = Array.isArray(payload[0])
    ? payload[0]
      .map((part) => Array.isArray(part) && typeof part[0] === "string" ? part[0] : "")
      .join("")
      .trim()
    : "";
  const result = postProcessChinese(translated || text);
  cache.set(text, result);
  return result;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { texts?: unknown };
    const texts = Array.isArray(body.texts) ? body.texts.filter((item): item is string => typeof item === "string") : [];
    const uniqueTexts = [...new Set(texts)].slice(0, 120);
    const translated = await Promise.all(uniqueTexts.map(async (text) => [text, await translateOne(text)] as const));
    const translations = Object.fromEntries(translated);
    return NextResponse.json({ translations });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "translate failed" }, { status: 500 });
  }
}
