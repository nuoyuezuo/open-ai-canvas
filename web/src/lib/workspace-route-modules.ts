const workspaceRouteLoaders = {
    assets: () => import("@/pages/assets"),
    canvas: () => import("@/pages/canvas"),
    comic: () => import("@/pages/comic"),
    "comic-drama": () => import("@/pages/comic-drama"),
    create: () => import("@/pages/create"),
    projects: () => import("@/pages/projects"),
    projectDetail: () => import("@/pages/projects/detail"),
    comicDetail: () => import("@/pages/comic/detail"),
};

export const loadAssetsPage = workspaceRouteLoaders.assets;
export const loadCanvasPage = workspaceRouteLoaders.canvas;
export const loadCanvasProjectPage = () => import("@/pages/canvas/project");
export const loadComicDetailPage = workspaceRouteLoaders.comicDetail;
export const loadComicDramaPage = workspaceRouteLoaders["comic-drama"];
export const loadComicPage = workspaceRouteLoaders.comic;
export const loadCreatePage = workspaceRouteLoaders.create;
export const loadProjectDetailPage = workspaceRouteLoaders.projectDetail;
export const loadProjectsPage = workspaceRouteLoaders.projects;

export function preloadWorkspaceRoute(pathnameOrSlug: string) {
    // 根路径就是创作页，预加载时仍映射到其内部模块名。
    const segments = pathnameOrSlug.replace(/^\//, "").split("/").filter(Boolean);
    const slug = segments[0] || "create";
    if ((slug === "projects" || slug === "comic") && segments.length > 1) {
        void (slug === "projects" ? workspaceRouteLoaders.projectDetail() : workspaceRouteLoaders.comicDetail());
        return;
    }
    const load = workspaceRouteLoaders[slug as keyof typeof workspaceRouteLoaders];
    if (load) void load();
}
