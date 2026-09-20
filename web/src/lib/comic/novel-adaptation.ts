import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { PromptTemplateOperation, promptTemplateTaskPlaceholder } from "@/lib/prompts";
import { runBackendGenerationTask } from "@/services/api/generation-task";
import { skillRuntime } from "@/services/skill-runtime";
import type { Skill } from "@/services/api/skills";
import type { AiConfig } from "@/stores/use-config-store";

export type NovelAdaptationCharacter = {
    name: string;
    role: string;
    appearance: string;
    personality: string;
    relationship: string;
};

export type NovelAdaptationEpisode = {
    title: string;
    summary: string;
    content: string;
};

/**
 * 防侵权检查项由后端 JSON 契约强制要求：模型必须显式列出仍然存在的相似点与风险，
 * 前端不能给缺失字段兜底，否则会把未复核的改编方案当成安全结果。
 */
export type NovelAdaptationCompliance = {
    similarities: string[];
    risks: string[];
    notes: string;
};

export type NovelAdaptationPlan = {
    title: string;
    synopsis: string;
    characters: NovelAdaptationCharacter[];
    world: string;
    episodes: NovelAdaptationEpisode[];
    compliance: NovelAdaptationCompliance;
};

export type NovelAdaptationSource = {
    kind: "user-provided" | "model-search" | "external-library";
    title: string;
    author: string;
    sourceUrl?: string;
    text: string;
    /** 是否来自检索结果；检索来源必须由用户确认授权后才能进入改编。 */
    retrieved: boolean;
    userOwned: boolean;
    licenseNote?: string;
};

export type NovelAdaptationInput = {
    source: NovelAdaptationSource;
    /** 用户自定义改编要求，例如篇幅、题材偏移、目标受众。 */
    instruction: string;
    config: AiConfig;
    skills: Skill[];
    selectedSkillIds: string[];
    signal?: AbortSignal;
};

export function parseNovelAdaptation(text: string): NovelAdaptationPlan {
    const cleaned = (text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("模型没有返回可用的改编方案");
    let payload: Record<string, unknown>;
    try {
        payload = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
        throw new Error("改编方案 JSON 无法解析，请重试");
    }
    const compliance = payload.compliance;
    if (!compliance || typeof compliance !== "object") throw new Error("改编方案缺少防侵权检查项，已拒绝导入");
    const complianceRecord = compliance as Record<string, unknown>;
    if (!Array.isArray(complianceRecord.similarities) || !Array.isArray(complianceRecord.risks) || typeof complianceRecord.notes !== "string") {
        throw new Error("改编方案缺少防侵权检查项，已拒绝导入");
    }
    const episodes = Array.isArray(payload.episodes) ? payload.episodes : [];
    const characters = Array.isArray(payload.characters) ? payload.characters : [];
    const title = String(payload.title || "").trim();
    const synopsis = String(payload.synopsis || "").trim();
    const world = String(payload.world || "").trim();
    if (!title || !synopsis || !world) throw new Error("改编方案缺少标题、简介或世界观");
    const parsedEpisodes = episodes.map((item) => {
        const record = typeof item === "object" && item ? item as Record<string, unknown> : {};
        return { title: String(record.title || "").trim(), summary: String(record.summary || "").trim(), content: String(record.content || "").trim() };
    }).filter((item) => item.title && item.content);
    if (!parsedEpisodes.length) throw new Error("改编方案没有可导入的章节内容");
    return {
        title,
        synopsis,
        world,
        characters: characters.map((item) => {
            const record = typeof item === "object" && item ? item as Record<string, unknown> : {};
            return {
                name: String(record.name || "").trim(),
                role: String(record.role || "").trim(),
                appearance: String(record.appearance || "").trim(),
                personality: String(record.personality || "").trim(),
                relationship: String(record.relationship || "").trim(),
            };
        }).filter((item) => item.name),
        episodes: parsedEpisodes,
        compliance: {
            similarities: (complianceRecord.similarities as unknown[]).map((item) => String(item)),
            risks: (complianceRecord.risks as unknown[]).map((item) => String(item)),
            notes: complianceRecord.notes,
        },
    };
}

/**
 * 检索来源只携带摘要与短摘录；完整正文必须由用户自行提供。
 * 这里再次收敛长度，避免页面把整章原文拼进改编提示词。
 */
export function adaptationSourceText(source: NovelAdaptationSource) {
    const text = source.text.trim();
    return source.retrieved ? Array.from(text).slice(0, 1200).join("") : text;
}

export function adaptationSourceDescription(source: NovelAdaptationSource) {
    const parts = [source.title.trim() || "未命名原作"];
    if (source.author.trim()) parts.push(`作者：${source.author.trim()}`);
    if (source.retrieved) parts.push("来源：检索结果（仅摘要与短摘录）");
    else parts.push("来源：用户自备文本");
    if (source.licenseNote?.trim()) parts.push(`版权说明：${source.licenseNote.trim()}`);
    return parts.join("\n");
}

export async function adaptNovel(input: NovelAdaptationInput): Promise<{ plan: NovelAdaptationPlan; skillCount: number }> {
    const text = adaptationSourceText(input.source);
    if (!text) throw new Error("改编素材不能为空");
    const config = buildGenerationConfig(input.config, undefined, "text");
    const skillExecution = await skillRuntime.prepare({
        profile: "comic",
        prompt: [adaptationSourceDescription(input.source), text, input.instruction.trim()].filter(Boolean).join("\n\n"),
        skills: input.skills,
        selectedSkillIds: input.selectedSkillIds,
    });
    const result = await runBackendGenerationTask({
        mode: "text",
        prompt: promptTemplateTaskPlaceholder("小说改编"),
        config,
        metadata: {
            source: "comic-novel-adaptation",
            promptTemplateOperation: PromptTemplateOperation.NovelAdaptation,
            promptTemplateVariables: {
                改编要求: [input.instruction.trim() || "在保留题材与情感结构的前提下重建人物、世界观与情节。", adaptationSourceDescription(input.source)].join("\n"),
            },
            ...skillExecution.metadata,
        },
        signal: input.signal,
    });
    return { plan: parseNovelAdaptation(result.text || ""), skillCount: skillExecution.selectedSkills.length };
}

export type NovelSearchQuery = {
    keywords: string[];
    genres: string[];
    exclude: string[];
    note: string;
};

export function parseNovelSearchQuery(text: string): NovelSearchQuery {
    const cleaned = (text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("模型没有返回可用的检索条件");
    let payload: Record<string, unknown>;
    try {
        payload = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
        throw new Error("检索条件 JSON 无法解析，请重试");
    }
    const keywords = stringList(payload.keywords);
    // 关键词是检索的唯一入口；缺失时不能退化成全文检索，否则等于把用户创意当查询串透传。
    if (!keywords.length) throw new Error("检索条件缺少关键词，已拒绝检索");
    return { keywords, genres: stringList(payload.genres), exclude: stringList(payload.exclude), note: String(payload.note || "").trim() };
}

function stringList(value: unknown) {
    return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

export type NovelSearchQueryInput = {
    idea: string;
    config: AiConfig;
    signal?: AbortSignal;
};

/** 把用户的一句话创意收敛成检索条件，避免把长文本直接当作查询串发往外部资料库。 */
export async function buildNovelSearchQuery(input: NovelSearchQueryInput): Promise<NovelSearchQuery> {
    const idea = input.idea.trim();
    if (!idea) throw new Error("请先描述想要的题材或故事方向");
    const result = await runBackendGenerationTask({
        mode: "text",
        prompt: promptTemplateTaskPlaceholder("小说检索条件"),
        config: buildGenerationConfig(input.config, undefined, "text"),
        metadata: {
            source: "comic-novel-search-query",
            promptTemplateOperation: PromptTemplateOperation.NovelSearchQuery,
            promptTemplateVariables: { 用户创意: idea },
        },
        signal: input.signal,
    });
    return parseNovelSearchQuery(result.text || "");
}
