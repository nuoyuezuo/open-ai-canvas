import { DEFAULT_PROJECT_ROUTE_BASE } from "@/lib/project-route-base";
import { SHORT_DRAMA_WORKFLOW_PROFILE } from "@/lib/project-workflow-profile";

import ProjectWorkbench, { type ProjectWorkbenchView } from "./detail/project-workbench";

const views: ProjectWorkbenchView[] = [
    { key: "overview", label: "制作概览" },
    { key: "chapters", label: "剧情章节" },
    { key: "workflow", label: "分镜制作" },
    { key: "canvases", label: "项目画布" },
    { key: "editor", label: "剪辑成片" },
    { key: "assets", label: "角色与资产" },
    { key: "settings", label: "项目设置" },
];

export default function ProjectDetailPage() {
    return <ProjectWorkbench profile={SHORT_DRAMA_WORKFLOW_PROFILE} routeBase={DEFAULT_PROJECT_ROUTE_BASE} views={views} listHref="/projects" listLabel="返回项目列表" />;
}
