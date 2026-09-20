import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { PromptTemplateOperation, promptTemplateTaskPlaceholder } from "@/lib/prompts";
import { formatShotOrdinal } from "@/lib/shot-label";
import { runBackendGenerationTask } from "@/services/api/generation-task";
import { skillRuntime } from "@/services/skill-runtime";
import type { Skill } from "@/services/api/skills";
import type { ProjectDetail, ShotRevisionInput } from "@/services/api/projects";
import type { AiConfig } from "@/stores/use-config-store";

import { chapterStoryboardAssets, chapterStoryboardCharacters, type ProjectShotReplacementInput } from "@/pages/projects/detail/chapter-storyboard-production";

export type ComicPanelDialogue = {
    kind: "speech" | "thought" | "narration" | "sfx" | string;
    speaker: string;
    text: string;
};

export type ComicPanel = {
    panelNumber: number;
    layout: string;
    shotSize: string;
    scene: string;
    characters: string[];
    action: string;
    dialogue: ComicPanelDialogue[];
    imagePrompt: string;
    negativePrompt: string;
    continuity: string;
};

export type ComicPanelScript = {
    title: string;
    panels: ComicPanel[];
};

const dialogueKindLabels: Record<string, string> = {
    speech: "对白",
    thought: "心理",
    narration: "旁白",
    sfx: "拟声",
};

export function parseComicPanelScript(text: string): ComicPanelScript {
    const cleaned = (text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("模型没有返回可用的分格脚本");
    let payload: Record<string, unknown>;
    try {
        payload = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
        throw new Error("分格脚本 JSON 无法解析，请重试");
    }
    const rawPanels = Array.isArray(payload.panels) ? payload.panels : [];
    const panels = rawPanels.map((item, index) => {
        const record = typeof item === "object" && item ? item as Record<string, unknown> : {};
        const dialogue = Array.isArray(record.dialogue) ? record.dialogue : [];
        return {
            panelNumber: Number(record.panelNumber) || index + 1,
            layout: String(record.layout || "").trim(),
            shotSize: String(record.shotSize || "").trim(),
            scene: String(record.scene || "").trim(),
            characters: Array.isArray(record.characters) ? record.characters.map((name) => String(name).trim()).filter(Boolean) : [],
            action: String(record.action || "").trim(),
            dialogue: dialogue.map((line): ComicPanelDialogue => {
                const lineRecord = typeof line === "object" && line ? line as Record<string, unknown> : {};
                return { kind: String(lineRecord.kind || "speech").trim(), speaker: String(lineRecord.speaker || "").trim(), text: String(lineRecord.text || "").trim() };
            }).filter((line) => line.text),
            imagePrompt: String(record.imagePrompt || "").trim(),
            negativePrompt: String(record.negativePrompt || "").trim(),
            continuity: String(record.continuity || "").trim(),
        };
    }).filter((panel) => panel.action || panel.imagePrompt);
    if (!panels.length) throw new Error("分格脚本没有可用的画格");
    return { title: String(payload.title || "").trim(), panels };
}

export function comicDialogueText(dialogue: ComicPanelDialogue[]) {
    return dialogue.map((line) => `${dialogueKindLabels[line.kind] || "对白"}${line.speaker ? `·${line.speaker}` : ""}：${line.text}`).join("\n");
}

export function comicPanelActionText(panel: ComicPanel) {
    return [
        panel.layout ? `版面：${panel.layout}` : "",
        panel.shotSize ? `景别：${panel.shotSize}` : "",
        panel.scene ? `场景：${panel.scene}` : "",
        panel.action ? `动作：${panel.action}` : "",
        panel.characters.length ? `出场：${panel.characters.join("、")}` : "",
        panel.continuity ? `接续：${panel.continuity}` : "",
    ].filter(Boolean).join("\n");
}

/** 画格写入项目镜头：一格对应一个 Shot，成稿画面沿用 storyboard 产物槽位。 */
export function comicPanelsToProjectShots(panels: ComicPanel[]): ProjectShotReplacementInput[] {
    return panels.map((panel, index) => {
        const description = panel.action.trim() || panel.scene.trim() || `画格 ${index + 1}`;
        const revision: ShotRevisionInput = {
            plotDescription: description,
            action: comicPanelActionText(panel),
            dialogue: comicDialogueText(panel.dialogue),
            shotSize: panel.shotSize,
            durationMs: 3000,
            imagePrompt: panel.imagePrompt,
            negativePrompt: panel.negativePrompt,
            continuityNotes: panel.continuity,
            actionBeats: [{ layout: panel.layout, panelNumber: panel.panelNumber }],
        };
        return {
            title: `${formatShotOrdinal(index)}`,
            description,
            durationMs: 3000,
            revision,
            assetVersionIds: [],
        };
    });
}

export type ComicPanelScriptInput = {
    projectId: string;
    projectName: string;
    projectStyle: string;
    chapterId: string;
    chapterTitle: string;
    sourceText: string;
    detail: ProjectDetail;
    config: AiConfig;
    skills: Skill[];
    selectedSkillIds: string[];
    signal?: AbortSignal;
};

/**
 * 分格脚本走文本模型与固定 JSON 契约：画格结构必须先确认，
 * 再逐格出图，避免重跑画面连带推翻已经确认的版面。
 */
export async function generateComicPanelScript(input: ComicPanelScriptInput) {
    const skillExecution = await skillRuntime.prepare({
        profile: "comic",
        prompt: [
            `漫画章节：${input.chapterTitle}`,
            input.sourceText,
            "请把本章拆成可直接交付作画的黑白漫画分格脚本，保持剧情因果、人物关系和关键对白完整。",
        ].join("\n\n"),
        skills: input.skills,
        selectedSkillIds: input.selectedSkillIds,
    });
    const result = await runBackendGenerationTask({
        mode: "text",
        prompt: promptTemplateTaskPlaceholder("漫画分格脚本"),
        config: buildGenerationConfig(input.config, undefined, "text"),
        metadata: {
            source: "comic-panel-script",
            domainProjectId: input.projectId,
            chapterId: input.chapterId,
            promptTemplateOperation: PromptTemplateOperation.ComicPanelScript,
            promptTemplateVariables: {
                项目名称: input.projectName,
                章节名称: input.chapterTitle,
                项目画风: input.projectStyle || "项目尚未指定画风，保持视觉描述中性、可执行。",
                章节正文: input.sourceText,
            },
            panelScriptContext: {
                characters: chapterStoryboardCharacters(input.detail, input.chapterId),
                assets: chapterStoryboardAssets(input.detail),
            },
            ...skillExecution.metadata,
        },
        signal: input.signal,
    });
    return { script: parseComicPanelScript(result.text || ""), skillCount: skillExecution.selectedSkills.length };
}
