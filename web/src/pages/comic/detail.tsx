import { COMIC_WORKFLOW_PROFILE, type ProjectWorkflowProfile } from "@/lib/project-workflow-profile";

import ProjectWorkbench, { type ProjectWorkbenchView } from "@/pages/projects/detail/project-workbench";

import { ComicPanelScriptStage } from "./panel-script-stage";

const comicViews: ProjectWorkbenchView[] = [
    { key: "overview", label: "制作概览" },
    { key: "chapters", label: "原著与改编" },
    { key: "workflow", label: "漫画制作" },
    { key: "canvases", label: "项目画布" },
    { key: "assets", label: "角色与场景" },
    { key: "settings", label: "项目设置" },
];

/** 漫剧当前复用漫画工作台；等漫剧功能落地后再替换 profile 与视图集合。 */
export default function ComicProjectDetailPage({ profile = COMIC_WORKFLOW_PROFILE, views = comicViews, listHref = "/comic", listLabel = "返回漫画项目列表" }: { profile?: ProjectWorkflowProfile; views?: ProjectWorkbenchView[]; listHref?: string; listLabel?: string }) {
    return (
        <ProjectWorkbench
            profile={profile}
            routeBase="/comic"
            views={views}
            listHref={listHref}
            listLabel={listLabel}
            renderWorkflowStage={({ stage, unitId, projectId, detail }) => stage === "panels" ? <ComicPanelScriptStage detail={detail} projectId={projectId} unitId={unitId} /> : null}
        />
    );
}
