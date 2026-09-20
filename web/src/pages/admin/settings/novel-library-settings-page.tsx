import { useCallback, useEffect, useRef, useState } from "react";
import { App, Button, Form, Input, Skeleton } from "antd";
import { AlertTriangle, KeyRound, RefreshCw, RotateCcw, Save, ShieldCheck } from "lucide-react";

import { Switch } from "@/pages/admin/ui/controls";
import { getAdminNovelLibrarySetting, updateAdminNovelLibrarySetting, type NovelLibrarySetting } from "@/services/api/novels";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatusBadge, configuredSecretText, SettingsSectionCard } from "../components/admin-ui";

type NovelLibraryForm = {
    enabled: boolean;
    endpoint: string;
    apiKey: string;
    label: string;
    licenseNote: string;
};

export default function NovelLibrarySettingsPage() {
    const { message } = App.useApp();
    const [setting, setSetting] = useState<NovelLibrarySetting | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");
    const [form] = Form.useForm<NovelLibraryForm>();
    const requestVersionRef = useRef(0);
    const watchedValues = Form.useWatch([], form) as Partial<NovelLibraryForm> | undefined;
    const draftEnabled = watchedValues?.enabled === true;
    const draftEndpoint = (watchedValues?.endpoint || "").trim();
    const usableApiKey = Boolean((watchedValues?.apiKey || "").trim()) || Boolean(setting?.hasApiKey);
    const prerequisitesReady = Boolean(draftEndpoint) && usableApiKey;

    const load = useCallback(
        async (initial = false, announce = false) => {
            const requestVersion = ++requestVersionRef.current;
            if (initial) setLoading(true);
            else setRefreshing(true);
            setLoadError("");
            try {
                const result = await getAdminNovelLibrarySetting();
                if (requestVersion !== requestVersionRef.current) return;
                setSetting(result.setting);
                setDirty(false);
                setSaveError("");
                if (announce) message.success("已重新读取小说资料库配置");
            } catch (error) {
                if (requestVersion !== requestVersionRef.current) return;
                const errorMessage = error instanceof Error ? error.message : "读取小说资料库配置失败";
                setLoadError(errorMessage);
                if (!initial) message.error(errorMessage);
            } finally {
                if (requestVersion === requestVersionRef.current) {
                    setLoading(false);
                    setRefreshing(false);
                }
            }
        },
        [message],
    );

    useEffect(() => {
        void load(true);
        return () => {
            requestVersionRef.current += 1;
        };
    }, [load]);

    useEffect(() => {
        if (loading || !setting) return;
        form.setFieldsValue({
            enabled: setting.enabled,
            endpoint: setting.endpoint || "",
            apiKey: "",
            label: setting.label || "",
            licenseNote: setting.licenseNote || "",
        });
    }, [form, loading, setting]);

    const save = async () => {
        if (!setting || saving) return;
        let values: NovelLibraryForm;
        try {
            values = await form.validateFields();
        } catch {
            return;
        }
        if (values.enabled && !values.endpoint.trim()) {
            message.error("启用外部小说资料库时必须填写接口地址");
            return;
        }
        if (values.enabled && !values.apiKey.trim() && !setting.hasApiKey) {
            message.error("启用外部小说资料库时必须填写访问密钥");
            return;
        }
        setSaving(true);
        setSaveError("");
        try {
            const result = await updateAdminNovelLibrarySetting({
                enabled: values.enabled,
                endpoint: values.endpoint.trim(),
                apiKey: values.apiKey.trim(),
                label: values.label.trim(),
                licenseNote: values.licenseNote.trim(),
            });
            setSetting(result.setting);
            form.setFieldsValue({ ...values, apiKey: "" });
            setDirty(false);
            message.success("小说资料库配置已保存");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "保存小说资料库配置失败";
            setSaveError(`${errorMessage}。未自动重试，请重新读取当前配置后再决定是否保存。`);
            message.error(errorMessage);
        } finally {
            setSaving(false);
        }
    };

    if (loading && !setting) {
        return (
            <AdminPageFrame title="小说资料库" description="为漫画小说检索配置可选的公开作品来源" scroll>
                <div className="admin-settings-stack"><Skeleton active paragraph={{ rows: 6 }} /></div>
            </AdminPageFrame>
        );
    }

    if (!setting) {
        return (
            <AdminPageFrame title="小说资料库" description="为漫画小说检索配置可选的公开作品来源" scroll>
                <div className="admin-settings-stack">
                    <div className="admin-ark-load-error" role="alert">
                        <span className="admin-ark-load-error-icon"><AlertTriangle className="size-5" aria-hidden="true" /></span>
                        <div>
                            <h2>无法读取小说资料库配置</h2>
                            <p>{loadError || "当前没有可显示的配置，请稍后重试。"}</p>
                        </div>
                        <Button icon={<RefreshCw className="size-4" />} loading={refreshing} onClick={() => void load(false, true)}>重新读取</Button>
                    </div>
                </div>
            </AdminPageFrame>
        );
    }

    return (
        <AdminPageFrame title="小说资料库" description="为漫画小说检索配置可选的公开作品来源" scroll>
            <div className="admin-settings-stack">
                <div className="admin-ark-command-bar">
                    <div className="admin-ark-command-copy" aria-live="polite">
                        <div className="flex flex-wrap items-center gap-2">
                            <strong>{dirty ? "小说资料库有调整待保存" : "小说资料库配置已同步"}</strong>
                            <AdminStatusBadge label={dirty ? "尚未生效" : "服务端配置"} tone={dirty ? "warning" : "neutral"} />
                        </div>
                    </div>
                    <div className="admin-ark-command-actions">
                        {dirty ? <Button icon={<RotateCcw className="size-4" />} disabled={saving} onClick={() => { form.setFieldsValue({ enabled: setting.enabled, endpoint: setting.endpoint || "", apiKey: "", label: setting.label || "", licenseNote: setting.licenseNote || "" }); setDirty(false); setSaveError(""); }}>撤销调整</Button> : null}
                        <Button icon={<RefreshCw className="size-4" />} loading={refreshing} disabled={saving} onClick={() => void load(false, true)}>刷新状态</Button>
                        <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty || loading || refreshing} onClick={() => void save()}>保存修改</Button>
                    </div>
                </div>
                {loadError || saveError ? (
                    <div className="admin-ark-inline-alert" role="alert">
                        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                        <span>{saveError || `${loadError}。页面仍显示上一次成功读取的配置。`}</span>
                    </div>
                ) : null}
                <Form
                    form={form}
                    layout="vertical"
                    requiredMark={false}
                    disabled={loading || refreshing || saving}
                    onValuesChange={() => { setDirty(true); setSaveError(""); }}
                >
                    <SettingsSectionCard
                        icon={<ShieldCheck className="size-4" aria-hidden="true" />}
                        title="1. 检索来源"
                        description="未配置时漫画的小说检索只返回空结果，用户仍可上传自备文本改编。"
                        status={<AdminStatusBadge label={setting.enabled ? "已启用" : "未启用"} tone={setting.enabled ? "success" : "neutral"} />}
                    >
                        <div className="admin-ark-form-grid">
                            <Form.Item name="endpoint" label="接口地址" extra="必须是公网 HTTPS 地址；本机、私网和链路本地地址会被拒绝。">
                                <Input autoComplete="off" placeholder="https://example.com/api/novels/search" />
                            </Form.Item>
                            <Form.Item name="label" label="来源名称" extra="展示给用户的来源标签，例如「公共领域小说库」。">
                                <Input autoComplete="off" placeholder="公共领域小说库" />
                            </Form.Item>
                            <Form.Item name="apiKey" label={setting.hasApiKey ? `访问密钥（${configuredSecretText}）` : "访问密钥"} extra={setting.hasApiKey ? "留空保留原密钥。" : undefined}>
                                <Input.Password autoComplete="new-password" prefix={<KeyRound className="size-4 text-foreground/35" />} placeholder={setting.hasApiKey ? "留空保留原密钥" : "仅保存在服务端"} />
                            </Form.Item>
                            <Form.Item name="licenseNote" label="授权说明" extra="会随检索结果一起展示，说明来源方的版权声明。">
                                <Input autoComplete="off" placeholder="例如：仅收录公共领域与知识共享作品" />
                            </Form.Item>
                        </div>
                    </SettingsSectionCard>

                    {prerequisitesReady || draftEnabled ? (
                        <SettingsSectionCard
                            icon={<KeyRound className="size-4" aria-hidden="true" />}
                            title="2. 是否启用检索"
                            description="关闭后漫画的小说检索立即停止出站请求，不影响已创建的项目。"
                            status={<AdminStatusBadge label={draftEnabled ? "已启用" : "已停用"} tone={draftEnabled ? "success" : "neutral"} />}
                        >
                            <div className="admin-ark-policy-control">
                                <div className="admin-ark-policy-copy">
                                    <strong>允许漫画模块检索外部小说资料库</strong>
                                    <p>检索结果只包含摘要与短摘录，改编仍需用户确认授权。</p>
                                </div>
                                <div className="admin-ark-policy-switch">
                                    <span>{draftEnabled ? "启用" : "停用"}</span>
                                    <Form.Item name="enabled" valuePropName="checked" noStyle><Switch aria-label="启用外部小说资料库检索，保存修改后生效" /></Form.Item>
                                </div>
                            </div>
                        </SettingsSectionCard>
                    ) : null}
                </Form>
            </div>
        </AdminPageFrame>
    );
}
