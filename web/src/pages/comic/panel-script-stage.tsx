import { useMemo, useState } from "react";
import { App, Button, Modal } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { Clapperboard, Sparkles } from "lucide-react";
import { useNavigate } from "react-router";

import { ModelPicker } from "@/components/model-picker";
import { SkillRuntimePicker, useSkillRuntimeCatalog } from "@/components/skills/skill-runtime-picker";
import { Callout } from "@/components/ui/product/callout";
import { resolveProjectCanvasStyle } from "@/components/canvas/canvas-style-picker-modal";
import { comicPanelsToProjectShots, generateComicPanelScript } from "@/lib/comic/panel-script";
import { projectRoute, useProjectRouteBase } from "@/lib/project-route-base";
import { navigateToSettings } from "@/lib/settings-navigation";
import { replaceProjectUnitShots, type ProjectDetail } from "@/services/api/projects";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";

import { chapterStoryboardReplaceImpact } from "@/pages/projects/detail/chapter-storyboard-production";
import { formatCount, statusLabel } from "@/pages/projects/detail/shared";

type Props = {
    detail: ProjectDetail;
    projectId: string;
    unitId: string;
};

/**
 * 漫画「分格脚本」阶段：先用文本模型把章节正文拆成可作画的画格，
 * 确认后再逐格出图。生成结果整体替换本章画格，失败时不动现有数据。
 */
export function ComicPanelScriptStage({ detail, projectId, unitId }: Props) {
    const { message, modal } = App.useApp();
    const navigate = useNavigate();
    const routeBase = useProjectRouteBase();
    const queryClient = useQueryClient();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const { skills, loading: skillsLoading } = useSkillRuntimeCatalog();
    const [open, setOpen] = useState(false);
    const [model, setModel] = useState("");
    const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
    const [generating, setGenerating] = useState(false);
    const unit = detail.units.find((item) => item.id === unitId);
    const impact = useMemo(() => chapterStoryboardReplaceImpact(detail, unitId), [detail, unitId]);
    const textModel = model || effectiveConfig.textModel;

    if (!unit) return null;
    const sourceText = stripHtml(unit.sourceText);
    const projectStyle = resolveProjectCanvasStyle(detail.project.stylePresetId, detail.project.styleProfileJson);

    const generate = async () => {
        if (generating) return;
        const config = { ...effectiveConfig, model: textModel, textModel };
        if (!textModel || !isAiConfigReady(config, textModel)) {
            navigateToSettings({ continueCreation: true });
            return;
        }
        if (!sourceText) {
            message.warning("当前章节还没有可用于分格的正文");
            return;
        }
        setOpen(false);
        setGenerating(true);
        try {
            const result = await generateComicPanelScript({
                projectId,
                projectName: detail.project.name,
                projectStyle: projectStyle?.prompt || "",
                chapterId: unitId,
                chapterTitle: unit.title,
                sourceText,
                detail,
                config,
                skills,
                selectedSkillIds,
            });
            const shots = comicPanelsToProjectShots(result.script.panels);
            await replaceProjectUnitShots(projectId, unitId, shots, detail.shots.filter((shot) => shot.unitId === unitId).map((shot) => shot.id));
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
                queryClient.invalidateQueries({ queryKey: ["projects"] }),
            ]);
            message.success(result.skillCount ? `已生成 ${shots.length} 个画格，并应用 ${result.skillCount} 个技能` : `已生成 ${shots.length} 个画格`);
            navigate(projectRoute(routeBase, projectId, "workflow", unitId, "inking"));
        } catch (error) {
            message.error(error instanceof Error ? `分格脚本生成失败：${error.message}` : "分格脚本生成失败");
        } finally {
            setGenerating(false);
        }
    };

    const confirmAndGenerate = () => {
        if (!impact.shotCount) {
            void generate();
            return;
        }
        modal.confirm({
            title: `替换本章已有的 ${impact.shotCount} 个画格？`,
            content: (
                <div className="space-y-2 text-sm leading-6 text-foreground/62">
                    <p>新分格脚本生成成功后，系统才会整体替换本章数据；如果生成失败，现有画格不会受到影响。</p>
                    <p>替换会移除 {impact.shotCount} 个画格、{impact.revisionCount} 个脚本版本、{impact.referenceCount} 个资产引用、{impact.artifactCount} 个成稿产物{impact.candidateCount ? `及 ${impact.candidateCount} 个相关候选资产` : ""}，此操作无法撤销。</p>
                </div>
            ),
            okText: "生成成功后替换",
            okButtonProps: { danger: true },
            cancelText: "保留现有画格",
            centered: true,
            onOk: () => void generate(),
        });
    };

    return (
        <div className="workflow-overview-scroll thin-scrollbar">
            <section className="mx-auto max-w-5xl">
                <div className="text-[var(--fs-micro)] font-medium uppercase tracking-[.18em] text-[var(--workspace-accent)]">03 / 分格脚本</div>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{unit.title}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground/50">先确认每格的叙事节拍、版面与对白，再逐格生成成稿画面。分格脚本来自本章正文与项目画风。</p>
                <div className="mt-6 grid gap-4 sm:grid-cols-3">
                    <PanelMetric label="当前画格" value={`${impact.shotCount} 格`} />
                    <PanelMetric label="章节字数" value={`${formatCount(sourceText.length)} 字`} />
                    <PanelMetric label="章节状态" value={statusLabel(unit.status)} />
                </div>
                {!sourceText ? <div className="mt-5"><Callout tone="warning" title="本章还没有正文">请先回到「原著与改编」补充章节内容，再生成分格脚本。</Callout></div> : null}
                {impact.shotCount ? <div className="mt-5"><Callout tone="info" title={`本章已有 ${impact.shotCount} 个画格`}>重新生成会整体替换本章画格及其脚本版本、资产引用和成稿产物。</Callout></div> : null}
                <div className="mt-6 rounded-xl border border-border/70 bg-surface p-5">
                    <div className="text-xs font-medium text-foreground/55">章节正文</div>
                    <div className="mt-3 max-h-[38vh] whitespace-pre-wrap text-sm leading-7 text-foreground/78">{sourceText || "当前章节还没有正文。"}</div>
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-3 border-y border-border/70 py-5">
                    <Button type="primary" icon={<Clapperboard className="size-3.5" />} loading={generating} disabled={!sourceText || generating} onClick={() => { setModel(textModel); setSelectedSkillIds([]); setOpen(true); }}>
                        {impact.shotCount ? "重新生成分格脚本" : "生成分格脚本"}
                    </Button>
                    {impact.shotCount ? <Button onClick={() => navigate(projectRoute(routeBase, projectId, "workflow", unitId, "inking"))}>直接进入成稿画面</Button> : null}
                    <span className="text-[var(--fs-tiny)] text-foreground/42">生成结果会写入本章画格，可在成稿画面阶段逐格调整。</span>
                </div>
            </section>
            <Modal className="library-modal" title="生成分格脚本" open={open} width={560} okText={impact.shotCount ? "重新生成" : "生成"} cancelText="取消" okButtonProps={{ disabled: !textModel }} onCancel={() => setOpen(false)} onOk={confirmAndGenerate} styles={{ body: { paddingTop: 12 } }}>
                <div className="grid gap-4">
                    <div className="rounded-lg border border-border/70 bg-foreground/[.018] px-3 py-2.5">
                        <div className="text-[var(--fs-tiny)] text-foreground/42">当前章节</div>
                        <div className="mt-1 truncate text-sm font-medium text-foreground/85">{unit.title}</div>
                        <div className="mt-1 text-[var(--fs-tiny)] text-foreground/38">正文会作为分格依据，生成结果会整体替换本章画格。</div>
                    </div>
                    <label className="block">
                        <span className="mb-1.5 block text-xs font-medium text-foreground/68">文本模型</span>
                        <ModelPicker config={effectiveConfig} capability="text" value={textModel} onChange={setModel} variant="creation" fullWidth placeholder="选择用于生成分格脚本的文本模型" showSelectedPrice={false} onMissingConfig={() => navigateToSettings({ continueCreation: true })} />
                    </label>
                    <div>
                        <label className="block">
                            <span className="mb-1.5 block text-xs font-medium text-foreground/68">分格技能</span>
                            <SkillRuntimePicker profile="comic" skills={skills} loading={skillsLoading} value={selectedSkillIds} onChange={setSelectedSkillIds} placeholder="选择本次分格使用的技能" />
                        </label>
                        <p className="mt-2 text-[var(--fs-tiny)] leading-5 text-foreground/42">可不选，最多 4 个。所选技能会在本次生成时由统一 Skill Runtime 按需读取，并记录实际使用的版本和文件。</p>
                    </div>
                </div>
            </Modal>
        </div>
    );
}

function PanelMetric({ label, value }: { label: string; value: string }) {
    return <div className="border-t border-border/70 py-4"><div className="text-xs font-medium text-foreground/55">{label}</div><div className="mt-2 text-2xl font-semibold">{value}</div></div>;
}

function stripHtml(value: string) {
    return value.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
}
