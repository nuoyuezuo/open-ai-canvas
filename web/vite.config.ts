import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const webDir = dirname(fileURLToPath(import.meta.url));
const appVersion = process.env.CANVAS_BUILD_VERSION?.trim() || readFileSync(resolve(webDir, "../VERSION"), "utf8").trim();
const appChangelog = readFileSync(resolve(webDir, "../CHANGELOG.md"), "utf8");
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET?.trim() || "http://127.0.0.1:8787";

// 本地开发默认走明文 HTTP。用公网 IP 访问时浏览器不提供 Web Locks 与
// crypto.randomUUID（安全上下文限制），生成结果落库会直接失败；
// 没有域名时用 VITE_DEV_HTTPS=1 配合自签证书切换到 HTTPS，端口号不影响判定。
function devHttpsConfig() {
    if (process.env.VITE_DEV_HTTPS !== "1") return undefined;
    const certPath = process.env.VITE_DEV_HTTPS_CERT?.trim() || resolve(webDir, "../.local/certs/dev-cert.pem");
    const keyPath = process.env.VITE_DEV_HTTPS_KEY?.trim() || resolve(webDir, "../.local/certs/dev-key.pem");
    try {
        return { cert: readFileSync(certPath), key: readFileSync(keyPath) };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`VITE_DEV_HTTPS=1 requires a readable certificate and key; run web/scripts/dev-https-cert.sh first (looked for ${certPath} and ${keyPath}): ${reason}`);
    }
}

export default defineConfig({
    plugins: [react()],
    define: {
        __APP_VERSION__: JSON.stringify(appVersion),
        __APP_CHANGELOG__: JSON.stringify(appChangelog),
        "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
    },
    server: {
        https: devHttpsConfig(),
        proxy: {
            "/api": {
                target: apiProxyTarget,
                changeOrigin: true,
                xfwd: true,
            },
            "/oauth/linuxdo/callback": {
                target: apiProxyTarget,
                changeOrigin: true,
                xfwd: true,
            },
        },
    },
    resolve: {
        alias: {
            "@": resolve(webDir, "src"),
        },
    },
    build: {
        rolldownOptions: {
            output: {
                strictExecutionOrder: true,
                codeSplitting: {
                    // Keep route-level lazy imports isolated. Recursively merging dependencies
                    // pulls unrelated pages into the initial modulepreload graph.
                    includeDependenciesRecursively: false,
                    minSize: 40 * 1024,
                    groups: [
                        {
                            // Shared interop helpers must not be emitted into a route entry:
                            // AntD would import that entry back and execute its bootstrap early.
                            name: "vendor-babel-runtime",
                            minSize: 0,
                            test: /node_modules[\\/]@babel[\\/]runtime[\\/]/,
                            priority: 40,
                        },
                        {
                            name: "vendor-react",
                            test: /node_modules[\\/](?:react(?:-dom|-router|-router-dom)?|scheduler|zustand|use-sync-external-store|@tanstack[\\/](?:query-core|react-query))[\\/]/,
                            priority: 30,
                        },
                        {
                            name: "vendor-icons",
                            test: /node_modules[\\/](?:lucide-react|@ant-design[\\/]icons)[\\/]/,
                            priority: 20,
                            entriesAware: true,
                            entriesAwareMergeThreshold: 48 * 1024,
                        },
                        {
                            name: "vendor-antd",
                            test: /node_modules[\\/](?:antd|@ant-design|@rc-component|rc-[^\\/]+|dayjs)[\\/]/,
                            priority: 10,
                            entriesAware: true,
                            entriesAwareMergeThreshold: 80 * 1024,
                        },
                    ],
                },
            },
        },
    },
});
