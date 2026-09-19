import { useState, type CSSProperties, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { appearanceLogoURL, useAppearanceStore } from "@/stores/use-appearance-store";
import type { ThemeName } from "@/stores/use-theme-store";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";

type BrandLogoProps = {
    className?: string;
    fallback?: ReactNode;
    alt?: string;
    theme?: ThemeName | "auto";
};

// 内置品牌标记：单色路径跟随 currentColor，深浅界面共用同一几何形状。
export function BuiltinBrandMark({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 64 64" className={cn("block", className)} fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M4 6h26v10H14v32h16v10H4V6Z" />
            <path d="M34 6h10l8 24H42L34 6Z" />
            <path d="M60 6H50l-8 24h10L60 6Z" />
            <rect x="42" y="30" width="10" height="28" />
        </svg>
    );
}

export function BrandLogo({ className, fallback, alt = "", theme = "auto" }: BrandLogoProps) {
    const appearance = useAppearanceStore((state) => state.appearance);
    const currentTheme = useActiveTheme();
    const source = appearanceLogoURL(appearance, theme === "auto" ? currentTheme : theme);
    const [failedSource, setFailedSource] = useState<string | null>(null);
    if (!appearance.logoConfigured) return <>{fallback ?? <BuiltinBrandMark className={className} />}</>;
    // A configured custom logo must never fall through to the built-in brand
    // when its file becomes unavailable. Keep its footprint neutral instead.
    if (failedSource === source) return <span className={cn("block", className)} aria-hidden="true" />;
    return (
        <img
            src={source}
            alt={alt}
            className={cn("block object-contain", className)}
            draggable={false}
            onError={(event) => {
                event.currentTarget.style.visibility = "hidden";
                setFailedSource(source);
            }}
        />
    );
}

export function BrandLogoFrame({ className, logoClassName, fallback, alt = "", theme = "auto" }: BrandLogoProps & { logoClassName?: string }) {
    const frameEnabled = useAppearanceStore((state) => state.appearance.logoFrameEnabled);
    const unframedStyle: CSSProperties | undefined = frameEnabled
        ? undefined
        : {
              background: "transparent",
              borderColor: "transparent",
              borderRadius: 0,
              boxShadow: "none",
              color: "inherit",
          };
    return (
        <span className={cn("brand-logo-frame", className)} data-logo-frame-enabled={frameEnabled} style={unframedStyle}>
            <BrandLogo className={logoClassName} fallback={fallback} alt={alt} theme={theme} />
        </span>
    );
}
