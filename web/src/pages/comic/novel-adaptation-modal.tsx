import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { App, Button, Checkbox, Input, Select, Steps } from "antd";
import { AlertTriangle, BookOpenText, FileUp, Loader2, Search, ShieldCheck, Sparkles } from "lucide-react";

import type { CanvasStylePreset } from "@/components/canvas/canvas-style-picker-modal";
import { ModelPicker } from "@/components/model-picker";
import { Callout } from "@/components/ui/product/callout";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { SkillRuntimePicker, useSkillRuntimeCatalog } from "@/components/skills/skill-runtime-picker";
import { createStyleProfileSnapshot, serializeStyleProfile } from "@/lib/canvas/style-profile";
import { decodeNovelText } from "@/lib/canvas/canvas-document";
import { adaptNovel, buildNovelSearchQuery, type NovelAdaptationPlan, type NovelAdaptationSource } from "@/lib/comic/novel-adaptation";
import { navigateToSettings } from "@/lib/settings-navigation";
import { createProject, importProjectUnits } from "@/services/api/projects";
import { novelCopyrightLabel, novelNeedsAuthorization, searchNovels, type NovelSearchResult } from "@/services/api/novels";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";

type Props = {
    open: boolean;
    stylePreset: CanvasStylePreset | null;
    onClose: () => void;
    onCreated: (projectId: string, firstUnitId?: string) => void;
};

type SourceMode = "search" | "text";

const manualSourceText = "用户自备文本，由上传者自行承担版权责任。";

export function NovelAdaptationModal({ open, stylePreset, onClose, onCreated }: Props) {
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const { skills, loading: skillsLoading } = useSkillRuntimeCatalog();
    const [mode, setMode] = useState<SourceMode>("search");
    const [model, setModel] = useState("");
    const [idea, setIdea] = useState("");
    const [searching, setSearching] = useState(false);
    const [libraryConfigured, setLibraryConfigured] = useState<boolean | null>(null);
    const [results, setResults] = useState<NovelSearchResult[]>([]);
    const [selected, setSelected] = useState<NovelSearchResult | null>(null);
    const [authorized, setAuthorized] = useState(false);
    const [manualTitle, setManualTitle] = useState("");
    const [manualText, setManualText] = useState("");
    const [fileName, setFileName] = useState("");
    const [instruction, setInstruction] = useState("");
    const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
    const [adapting, setAdapting] = useState(false);
    const [plan, setPlan] = useState<NovelAdaptationPlan | null>(null);
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        if (open) return;
        setMode("search");
        setIdea("");
        setResults([]);
        setSelected(null);
        setAuthorized(false);
        setManualTitle("");
        setManualText("");
        setFileName("");
        setInstruction("");
        setSelectedSkillIds([]);
        setPlan(null);
        setLibraryConfigured(null);
    }, [open]);

    const textModel = model || effectiveConfig.textModel;
    const source = useMemo<NovelAdaptationSource | null>(() => {
        if (mode === "text") {
            const text = manualText.trim();
            if (!text) return null;
            return { kind: "user-provided", title: manualTitle.trim() || fileName || "自备文本", author: "", text, retrieved: false, userOwned: true, licenseNote: manualSourceText };
        }
        if (!selected) return null;
        return {
            kind: selected.source,
            title: selected.title,
            author: selected.author,
            sourceUrl: selected.sourceUrl,
            // 检索结果只带摘要与短摘录；正文仍由模型重建，避免复制受版权保护的原文。
            text: [selected.summary, selected.excerpt].filter(Boolean).join("\n\n"),
            retrieved: true,
            userOwned: false,
            licenseNote: selected.licenseNote || novelCopyrightLabel(selected.copyrightStatus),
        };
    }, [fileName, manualText, manualTitle, mode, selected]);

    const requiresAuthorization = mode === "search" && Boolean(selected && novelNeedsAuthorization(selected.copyrightStatus));
    const sourceReady = Boolean(source) && (!requiresAuthorization || authorized);
    const textModelReady = Boolean(textModel) && isAiConfigReady({ ...effectiveConfig, model: textModel, textModel }, textModel);

    const runSearch = async () => {
        if (searching) return;
        if (!textModelReady) {
            navigateToSettings({ continueCreation: true });
            return;
        }
        setSearching(true);
        setSelected(null);
        setAuthorized(false);
        setPlan(null);
        try {
            // 先由文本模型把一句话创意收敛成检索条件，避免把长文本直接当作查询串发往外部资料库。
            const query = await buildNovelSearchQuery({ idea, config: { ...effectiveConfig, model: textModel, textModel } });
            const response = await searchNovels({ keywords: query.keywords, genres: query.genres, exclude: query.exclude, limit: 10 });
            setLibraryConfigured(response.libraryConfigured);
            setResults(response.results);
            if (!response.libraryConfigured) message.info("当前部署未配置外部小说资料库，可改用自备文本改编");
            else if (!response.results.length) message.info("没有检索到匹配作品，可换一组关键词或改用自备文本");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "小说检索失败");
        } finally {
            setSearching(false);
        }
    };

    const runAdaptation = async () => {
        if (!source || !sourceReady || adapting) return;
        if (!textModelReady) {
            navigateToSettings({ continueCreation: true });
            return;
        }
        setAdapting(true);
        try {
            const result = await adaptNovel({
                source,
                instruction,
                config: { ...effectiveConfig, model: textModel, textModel },
                skills,
                selectedSkillIds,
            });
            setPlan(result.plan);
            message.success(result.skillCount ? `改编方案已生成，应用 ${result.skillCount} 个技能` : "改编方案已生成");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "小说改编失败");
        } finally {
            setAdapting(false);
        }
    };

    const confirmImport = async () => {
        if (!plan || creating) return;
        setCreating(true);
        try {
            const { project } = await createProject({
                name: plan.title.slice(0, 60),
                type: "comic",
                aspectRatio: "3:4",
                sourceType: mode === "text" ? "text" : "novel",
                description: plan.synopsis,
                ...(stylePreset ? { stylePresetId: stylePreset.id, styleProfileJson: serializeStyleProfile(stylePreset.profile || createStyleProfileSnapshot(stylePreset)) } : {}),
            });
            const { units } = await importProjectUnits(project.id, plan.episodes.map((episode) => ({
                kind: "chapter",
                title: episode.title,
                sourceText: plainTextToHtml([episode.summary, episode.content].filter(Boolean).join("\n\n")),
            })));
            message.success(`已创建漫画项目并导入 ${units.length} 章`);
            onCreated(project.id, units[0]?.id);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "改编方案导入失败");
        } finally {
            setCreating(false);
        }
    };

    const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        setFileName(file.name);
        if (!manualTitle.trim()) setManualTitle(file.name.replace(/\.[^.]+$/, ""));
        setManualText(decodeNovelText(await file.arrayBuffer()));
    };

    const step = plan ? 2 : source ? 1 : 0;
    return (
        <AppModal flush title={null} open={open} footer={null} onCancel={onClose} width={880}>
            <div className="flex max-h-[86vh] flex-col">
                <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
                    <div className="min-w-0">
                        <h2 className="text-sm font-semibold">小说改编</h2>
                        <p className="mt-0.5 text-[var(--fs-tiny)] text-foreground/45">检索或上传原作，先做防侵权改编，再导入为漫画章节</p>
                    </div>
                    <Steps size="small" current={step} className="hidden shrink-0 md:flex" items={[{ title: "选择原作" }, { title: "改编方案" }, { title: "导入章节" }]} />
                </header>
                <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
                        <div className="min-w-0 space-y-4">
                            <div className="flex gap-2">
                                <Button type={mode === "search" ? "primary" : "default"} onClick={() => setMode("search")}>AI 检索现有小说</Button>
                                <Button type={mode === "text" ? "primary" : "default"} onClick={() => setMode("text")}>自备文本</Button>
                            </div>
                            {mode === "search" ? (
                                <div className="space-y-3">
                                    <Callout tone="info" title="防侵权改编">
                                        检索结果只提供摘要与短摘录，改编会重建人物、世界观与情节。仍处于版权保护期或来源不明的作品必须先确认授权，改编结果也会列出残留相似点供人工复核。
                                    </Callout>
                                    <div className="flex gap-2">
                                        <Input value={idea} onChange={(event) => setIdea(event.target.value)} placeholder="描述想要的题材或故事方向，例如：海港城市的身份互换悬疑" onPressEnter={() => void runSearch()} />
                                        <Button icon={searching ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />} disabled={!idea.trim() || searching} onClick={() => void runSearch()}>检索</Button>
                                    </div>
                                    {libraryConfigured === false ? <p className="text-[var(--fs-tiny)] text-foreground/45">当前部署未配置外部小说资料库，检索不会返回结果；请改用自备文本改编，或联系管理员在后台配置。</p> : null}
                                    {results.length ? (
                                        <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/70">
                                            {results.map((item) => (
                                                <button
                                                    key={item.id}
                                                    type="button"
                                                    onClick={() => { setSelected(item); setAuthorized(false); setPlan(null); }}
                                                    className={`flex w-full flex-col items-start gap-1 px-3 py-2.5 text-left transition-colors ${selected?.id === item.id ? "bg-surface-active" : "hover:bg-surface-hover"}`}
                                                >
                                                    <span className="flex w-full items-center gap-2"><strong className="min-w-0 flex-1 truncate text-xs">{item.title}</strong><em className="shrink-0 text-[var(--fs-tiny)] not-italic text-foreground/40">{item.sourceLabel}</em></span>
                                                    <span className="text-[var(--fs-tiny)] text-foreground/45">{item.author || "作者未标注"} · {novelCopyrightLabel(item.copyrightStatus)}</span>
                                                    {item.summary ? <span className="line-clamp-2 text-[var(--fs-tiny)] leading-5 text-foreground/38">{item.summary}</span> : null}
                                                </button>
                                            ))}
                                        </div>
                                    ) : null}
                                    {selected ? (
                                        <div className="rounded-lg border border-border/70 p-3">
                                            <div className="text-xs font-medium">已选择：{selected.title}</div>
                                            {novelNeedsAuthorization(selected.copyrightStatus) ? (
                                                <Checkbox className="mt-2" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)}>
                                                    <span className="text-xs leading-5">我确认有权基于该作品进行改编，并自行承担由此产生的版权责任（{novelCopyrightLabel(selected.copyrightStatus)}）</span>
                                                </Checkbox>
                                            ) : (
                                                <p className="mt-2 text-[var(--fs-tiny)] text-foreground/45">{novelCopyrightLabel(selected.copyrightStatus)}，可直接改编。</p>
                                            )}
                                        </div>
                                    ) : null}
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <Callout tone="warning" title="自备文本由上传者承担责任">
                                        只上传自己拥有版权的作品。系统会按同样的防侵权规则重建人物与情节，但不会替你核实素材来源。
                                    </Callout>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <Input value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} placeholder="原作名称（可选）" />
                                        <Button icon={<FileUp className="size-3.5" />} onClick={() => document.getElementById("comic-novel-upload")?.click()}>{fileName || "选择 TXT / MD 文件"}</Button>
                                        <input id="comic-novel-upload" type="file" accept=".txt,.md,text/plain,text/markdown" className="hidden" onChange={(event) => void readFile(event)} />
                                    </div>
                                    <Input.TextArea value={manualText} onChange={(event) => setManualText(event.target.value)} autoSize={{ minRows: 8, maxRows: 14 }} placeholder="也可以直接粘贴原作正文或详细梗概" />
                                </div>
                            )}
                            <div className="grid gap-3 sm:grid-cols-2">
                                <label className="block">
                                    <span className="mb-1.5 block text-xs font-medium text-foreground/68">文本模型</span>
                                    <ModelPicker config={effectiveConfig} capability="text" value={textModel} onChange={setModel} variant="creation" fullWidth placeholder="选择用于检索条件与改编的文本模型" showSelectedPrice={false} onMissingConfig={() => navigateToSettings({ continueCreation: true })} />
                                </label>
                                <label className="block">
                                    <span className="mb-1.5 block text-xs font-medium text-foreground/68">改编技能</span>
                                    <SkillRuntimePicker profile="comic" skills={skills} loading={skillsLoading} value={selectedSkillIds} onChange={setSelectedSkillIds} placeholder="选择本次改编使用的技能" />
                                </label>
                            </div>
                            <label className="block">
                                <span className="mb-1.5 block text-xs font-medium text-foreground/68">改编要求（可选）</span>
                                <Input.TextArea value={instruction} onChange={(event) => setInstruction(event.target.value)} autoSize={{ minRows: 3, maxRows: 6 }} placeholder="例如：改为校园悬疑，控制篇幅在 8 章，每章 1200 字" />
                            </label>
                            <Button type="primary" icon={<Sparkles className="size-3.5" />} loading={adapting} disabled={!sourceReady || adapting} onClick={() => void runAdaptation()}>
                                {plan ? "重新生成改编方案" : "生成防侵权改编方案"}
                            </Button>
                        </div>
                        <aside className="min-w-0 space-y-3">
                            {plan ? (
                                <>
                                    <div className="rounded-lg border border-border/70 p-3">
                                        <div className="text-xs font-medium">{plan.title}</div>
                                        <p className="mt-2 text-[var(--fs-tiny)] leading-5 text-foreground/50">{plan.synopsis}</p>
                                        <p className="mt-2 text-[var(--fs-tiny)] leading-5 text-foreground/40">{plan.world}</p>
                                    </div>
                                    <div className="rounded-lg border border-border/70 p-3">
                                        <div className="text-xs font-medium">角色 {plan.characters.length} 位 · 章节 {plan.episodes.length} 章</div>
                                        <ul className="mt-2 space-y-1 text-[var(--fs-tiny)] text-foreground/45">
                                            {plan.characters.slice(0, 6).map((character) => <li key={character.name} className="truncate">{character.name} · {character.role || "未标注定位"}</li>)}
                                        </ul>
                                    </div>
                                    <div className="rounded-lg border border-[color-mix(in_srgb,var(--workspace-accent)_30%,transparent)] p-3">
                                        <div className="flex items-center gap-1.5 text-xs font-medium"><ShieldCheck className="size-3.5" />防侵权检查</div>
                                        {plan.compliance.similarities.length ? <ul className="mt-2 space-y-1 text-[var(--fs-tiny)] text-foreground/50">{plan.compliance.similarities.map((item) => <li key={item}>相似点：{item}</li>)}</ul> : <p className="mt-2 text-[var(--fs-tiny)] text-foreground/45">模型未列出残留相似点。</p>}
                                        {plan.compliance.risks.length ? <ul className="mt-2 space-y-1 text-[var(--fs-tiny)] text-amber-600 dark:text-amber-500">{plan.compliance.risks.map((item) => <li key={item}>风险：{item}</li>)}</ul> : null}
                                        {plan.compliance.notes ? <p className="mt-2 text-[var(--fs-tiny)] leading-5 text-foreground/45">{plan.compliance.notes}</p> : null}
                                    </div>
                                    <Button type="primary" block loading={creating} onClick={() => void confirmImport()}>创建漫画项目并导入 {plan.episodes.length} 章</Button>
                                </>
                            ) : (
                                <div className="grid h-full min-h-40 place-items-center rounded-lg border border-dashed border-border/70 p-4 text-center text-[var(--fs-tiny)] leading-5 text-foreground/40">
                                    <span><BookOpenText className="mx-auto mb-2 size-5" />先选择原作并生成改编方案，这里会显示角色、章节与防侵权检查结果</span>
                                </div>
                            )}
                        </aside>
                    </div>
                </div>
                {requiresAuthorization && !authorized ? (
                    <footer className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2.5 text-[var(--fs-tiny)] text-amber-600 dark:text-amber-500">
                        <AlertTriangle className="size-3.5" />该作品仍在版权保护期或来源不明，确认授权后才能生成改编方案。
                    </footer>
                ) : null}
            </div>
        </AppModal>
    );
}

function plainTextToHtml(value: string) {
    const escaped = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return escaped.split(/\n{2,}/).map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`).join("");
}
