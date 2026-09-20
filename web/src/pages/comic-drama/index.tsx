import { Button } from "antd";
import { Construction, Film } from "lucide-react";
import { Link } from "react-router";

import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";

/**
 * 漫剧入口先做骨架：漫剧复用漫画的分格流程，但需要额外的镜头运动、配音与动态合成能力。
 * 在漫画功能完善前只提供说明与跳转，不接入未完成的生产链路。
 */
export default function ComicDramaPage() {
    return (
        <WorkspacePage className="library-page">
            <PageHeader title="漫剧创作" description="分格漫画与动态演出结合的下一个模块。" />
            <section className="mt-4 rounded-xl border border-border/70 bg-surface p-6">
                <div className="flex items-start gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--workspace-accent-soft)] text-[var(--workspace-accent)]"><Film className="size-4" /></span>
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold">漫剧模块正在开发</h2>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground/55">
                            漫剧会复用漫画的分格脚本、画格成稿与角色资产链路，再补充镜头运动、配音和动态合成。
                            在漫画制作流程稳定前，本入口不提供生成能力，避免出现半成品的生产路径。
                        </p>
                        <ul className="mt-4 space-y-1.5 text-xs leading-5 text-foreground/45">
                            <li>分格与画格：沿用漫画工作台，正在验证中</li>
                            <li>动态演出与配音：待漫画流程完善后开发</li>
                            <li>小说改编与防侵权检查：与漫画共用同一套能力</li>
                        </ul>
                        <div className="mt-5 flex flex-wrap items-center gap-2">
                            <Link to="/comic"><Button type="primary" icon={<Construction className="size-3.5" />}>先使用漫画工作台</Button></Link>
                            <span className="text-[var(--fs-tiny)] text-foreground/42">已创建的漫剧项目也会出现在漫画项目列表中。</span>
                        </div>
                    </div>
                </div>
            </section>
        </WorkspacePage>
    );
}
