import { http } from "@/services/api/request";

/** 小说来源：用户自备、AI 检索条件、部署者配置的外部资料库。 */
export type NovelSourceKind = "user-provided" | "model-search" | "external-library";

export type NovelSearchResult = {
    id: string;
    title: string;
    author: string;
    source: NovelSourceKind;
    sourceLabel: string;
    sourceUrl?: string;
    genres: string[];
    summary: string;
    excerpt?: string;
    wordCount: number;
    /** public-domain / creative-commons / licensed / in-copyright / unknown */
    copyrightStatus: string;
    licenseNote?: string;
};

export type NovelSearchInput = {
    query?: string;
    keywords?: string[];
    genres?: string[];
    exclude?: string[];
    limit?: number;
};

export type NovelSearchResponse = {
    results: NovelSearchResult[];
    /** 部署者是否配置了外部资料库；未配置时结果为空是正常状态。 */
    libraryConfigured: boolean;
};

export type NovelLibrarySetting = {
    enabled: boolean;
    endpoint: string;
    label: string;
    licenseNote: string;
    headers: Record<string, string>;
    hasApiKey: boolean;
    updatedBy?: string;
    createdAt?: string;
    updatedAt?: string;
};

export type NovelLibrarySettingInput = {
    enabled: boolean;
    endpoint: string;
    /** 留空表示保留已存密钥，服务端不会回传明文。 */
    apiKey?: string;
    label: string;
    licenseNote: string;
    headers?: Record<string, string>;
};

export function searchNovels(input: NovelSearchInput, signal?: AbortSignal) {
    return http.post<NovelSearchResponse>("/novels/search", input, { signal });
}

export function getAdminNovelLibrarySetting() {
    return http.get<{ setting: NovelLibrarySetting }>("/admin/settings/novel-library");
}

export function updateAdminNovelLibrarySetting(input: NovelLibrarySettingInput) {
    return http.patch<{ setting: NovelLibrarySetting }>("/admin/settings/novel-library", input);
}

export function novelCopyrightLabel(status: string) {
    switch (status) {
        case "public-domain":
            return "已进入公共领域";
        case "creative-commons":
            return "采用知识共享许可";
        case "licensed":
            return "来源声明已授权";
        case "in-copyright":
            return "仍在版权保护期";
        default:
            return "版权状态未知，需人工确认";
    }
}

/** 只有明确可复用的版权状态才不强制二次确认；其余一律要求用户显式授权。 */
export function novelNeedsAuthorization(status: string) {
    return status !== "public-domain" && status !== "creative-commons";
}
