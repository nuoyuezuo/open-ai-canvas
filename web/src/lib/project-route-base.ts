import { createContext, useContext } from "react";

/**
 * 项目工作台的路由前缀。短剧和漫画共用同一套项目、章节、镜头与产物接口，
 * 但入口路径不同；把前缀抽成上下文，避免在每个详情视图里硬编码 /projects，
 * 也避免为了漫画复制一份工作台。
 */
export const DEFAULT_PROJECT_ROUTE_BASE = "/projects";

export const ProjectRouteBaseContext = createContext<string>(DEFAULT_PROJECT_ROUTE_BASE);

export function useProjectRouteBase() {
    return useContext(ProjectRouteBaseContext);
}

/** 拼接项目工作台内的路径。ID 由后端生成（UUID / 数字串），沿用既有路由不做额外编码。 */
export function projectRoute(base: string, projectId: string, ...segments: Array<string | undefined>) {
    const prefix = (base || DEFAULT_PROJECT_ROUTE_BASE).replace(/\/+$/, "");
    const tail = segments
        .filter((segment): segment is string => Boolean(segment && segment.trim()));
    return [prefix, projectId, ...tail].join("/");
}
