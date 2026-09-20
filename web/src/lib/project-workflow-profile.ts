/**
 * 项目生产工作流的能力描述。
 *
 * 短剧和漫画共用同一套后端接口：章节 = ProjectUnit，镜头/画格 = Shot，产物 = ShotArtifact。
 * 两者差别只在阶段语义、产物槽位和文案上，因此把差异集中在这里，而不是复制工作台实现。
 */

import { createContext, useContext } from "react";

import type { SkillRuntimeProfile } from "@/services/skill-runtime";

export type WorkflowStageKey = string;

/** 阶段的产物槽位。空字符串表示该阶段只产出脚本，不产出媒体文件。 */
export type WorkflowStageArtifact = {
    type: string;
    media: "image" | "video";
};

export type WorkflowStageDefinition = {
    key: WorkflowStageKey;
    label: string;
    shortLabel: string;
    /** 该阶段在工作台里生成什么；text 表示只维护脚本，不调用生成模型。 */
    generation: "image" | "video" | "text";
    artifact?: WorkflowStageArtifact;
    /** 生成按钮与空态文案。 */
    action: string;
    empty: string;
    /** 该阶段编辑器主提示词字段，text 阶段用不到。 */
    promptField?: "videoPrompt" | "imagePrompt";
    /** 生成时附加在提示词尾部的媒介约束。 */
    mediumHint?: string;
};

export type ProjectWorkflowProfile = {
    id: string;
    /** 阶段标题前缀，例如「01 / 原著与改编」。 */
    stageEyebrow: (stage: WorkflowStageKey, index: number) => string;
    stages: WorkflowStageDefinition[];
    /** 默认落地阶段，也是非法阶段值的回退目标。 */
    defaultStage: WorkflowStageKey;
    /** 工作台内的阶段切换顺序。 */
    productionStages: WorkflowStageKey[];
    /** 工作台左侧列表里对「镜头」的称呼。 */
    unitItemLabel: string;
    unitItemPlural: string;
    /** 单镜/单格的默认标题前缀，例如「镜头」或「第 1 格」。 */
    itemOrdinalLabel: string;
    /** 生成任务来源标记，用于任务列表与产物回填定位。 */
    taskSource: string;
    /** 技能运行时使用的 profile。 */
    skillProfile: SkillRuntimeProfile;
};

const shortDramaStages: WorkflowStageDefinition[] = [
    { key: "story", label: "剧情与章节", shortLabel: "剧情", generation: "text", action: "", empty: "" },
    { key: "assets", label: "资产拆分", shortLabel: "资产", generation: "text", action: "", empty: "" },
    {
        key: "storyboard", label: "分镜脚本", shortLabel: "分镜", generation: "image",
        artifact: { type: "storyboard", media: "image" }, promptField: "imagePrompt",
        action: "生成分镜图", empty: "生成静态分镜图，确认构图、景别与角色位置",
        mediumHint: "黑白分镜草图，清晰动作节拍，电影构图",
    },
    {
        key: "previz", label: "黑白动作预演", shortLabel: "预演", generation: "image",
        artifact: { type: "action_board", media: "image" }, promptField: "imagePrompt",
        action: "生成黑白预演", empty: "生成黑白动作预演，确认表演节拍与镜头运动",
        mediumHint: "黑白动作预演，强调动作节拍与镜头运动",
    },
    {
        key: "video", label: "视频生成", shortLabel: "视频", generation: "video",
        artifact: { type: "video", media: "video" }, promptField: "videoPrompt",
        action: "生成镜头视频", empty: "选择视频模型后生成当前镜头",
    },
    { key: "delivery", label: "交付与打包", shortLabel: "交付", generation: "text", artifact: { type: "video", media: "video" }, action: "", empty: "" },
];

// 漫画把分格脚本与成稿画面拆开：先确认每格叙事与版面，再逐格出图。
// 成稿画面复用 storyboard 槽位，交付导出复用 video 槽位，与后端阶段校验保持一致。
const comicStages: WorkflowStageDefinition[] = [
    { key: "story", label: "原著与改编", shortLabel: "原著", generation: "text", action: "", empty: "" },
    { key: "assets", label: "角色与场景", shortLabel: "资产", generation: "text", action: "", empty: "" },
    { key: "panels", label: "分格脚本", shortLabel: "分格", generation: "text", artifact: { type: "storyboard", media: "image" }, action: "", empty: "" },
    {
        key: "inking", label: "成稿画面", shortLabel: "成稿", generation: "image",
        artifact: { type: "storyboard", media: "image" }, promptField: "imagePrompt",
        action: "生成画格", empty: "逐格生成漫画成稿画面，保持角色与画风一致",
        mediumHint: "黑白漫画成稿，清晰网点与线条，稳定角色设计",
    },
    { key: "delivery", label: "交付与导出", shortLabel: "交付", generation: "text", artifact: { type: "delivery", media: "image" }, action: "", empty: "" },
];

export const SHORT_DRAMA_WORKFLOW_PROFILE: ProjectWorkflowProfile = {
    id: "short-drama",
    stageEyebrow: (_stage, index) => `${String(index + 1).padStart(2, "0")} / 制作阶段`,
    stages: shortDramaStages,
    defaultStage: "storyboard",
    productionStages: ["storyboard", "previz", "video"],
    unitItemLabel: "镜头",
    unitItemPlural: "镜头",
    itemOrdinalLabel: "镜头",
    taskSource: "short-drama-workflow",
    skillProfile: "shortDrama",
};

export const COMIC_WORKFLOW_PROFILE: ProjectWorkflowProfile = {
    id: "comic",
    stageEyebrow: (_stage, index) => `${String(index + 1).padStart(2, "0")} / 漫画阶段`,
    stages: comicStages,
    defaultStage: "panels",
    productionStages: ["inking"],
    unitItemLabel: "画格",
    unitItemPlural: "画格",
    itemOrdinalLabel: "第",
    taskSource: "comic-workflow",
    skillProfile: "comic",
};

export function workflowStage(profile: ProjectWorkflowProfile, key: string | undefined) {
    return profile.stages.find((stage) => stage.key === key);
}

export function workflowStageIndex(profile: ProjectWorkflowProfile, key: string | undefined) {
    return profile.stages.findIndex((stage) => stage.key === key);
}

/** 阶段是否属于工作台里的生产阶段（需要脚本编辑器与产物预览）。 */
export function isProductionStage(profile: ProjectWorkflowProfile, key: string | undefined) {
    return Boolean(key) && profile.productionStages.includes(key as string);
}

/** 当前项目工作台的阶段描述。短剧页面与漫画页面共用组件，由上下文区分语义。 */
export const ProjectWorkflowProfileContext = createContext<ProjectWorkflowProfile>(SHORT_DRAMA_WORKFLOW_PROFILE);

export function useProjectWorkflowProfile() {
    return useContext(ProjectWorkflowProfileContext);
}
