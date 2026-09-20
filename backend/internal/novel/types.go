// Package novel 提供漫画模块的小说检索与素材获取能力。
//
// 检索来源是可插拔的：默认只启用「用户自行提供」和「模型检索」两条路径，
// 外部小说资料库必须由部署者显式配置地址后才参与检索。所有出站请求都经过
// internal/outbound 的 SSRF 校验，禁止指向本机、私网和链路本地地址。
package novel

import "strings"

// SourceKind 标识一条检索结果的来源，前端据此提示可信度与后续处理方式。
type SourceKind string

const (
	SourceUserProvided SourceKind = "user-provided"
	SourceModelSearch  SourceKind = "model-search"
	SourceExternal     SourceKind = "external-library"
)

// SearchResult 是检索到的单条小说候选。Excerpt 只保留用于判断题材的短摘要，
// 不承载全文；完整正文必须由用户确认后再获取或由模型改编生成。
type SearchResult struct {
	ID          string     `json:"id"`
	Title       string     `json:"title"`
	Author      string     `json:"author"`
	Source      SourceKind `json:"source"`
	SourceLabel string     `json:"sourceLabel"`
	SourceURL   string     `json:"sourceUrl,omitempty"`
	Genres      []string   `json:"genres"`
	Summary     string     `json:"summary"`
	Excerpt     string     `json:"excerpt,omitempty"`
	WordCount   int        `json:"wordCount"`
	// CopyrightStatus 由来源声明或部署配置给出，unknown 表示必须人工确认后才能改编。
	CopyrightStatus string `json:"copyrightStatus"`
	LicenseNote     string `json:"licenseNote,omitempty"`
}

// SearchRequest 是检索入参。Keywords 由模型检索条件模板生成，避免直接透传用户长文本。
type SearchRequest struct {
	Query    string   `json:"query"`
	Keywords []string `json:"keywords"`
	Genres   []string `json:"genres"`
	Exclude  []string `json:"exclude"`
	Limit    int      `json:"limit"`
}

// AdaptationSource 是送入改编模型的素材。Retrieved 为检索结果时只带摘要与短摘录，
// 用户自备全文时由用户自行承担版权责任。
type AdaptationSource struct {
	Kind        SourceKind `json:"kind"`
	Title       string     `json:"title"`
	Author      string     `json:"author"`
	SourceURL   string     `json:"sourceUrl,omitempty"`
	Text        string     `json:"text"`
	Retrieved   bool       `json:"retrieved"`
	UserOwned   bool       `json:"userOwned"`
	LicenseNote string     `json:"licenseNote,omitempty"`
}

// NormalizeSearchRequest 收敛检索入参：限制条数、去空并做长度截断。
func NormalizeSearchRequest(req SearchRequest) SearchRequest {
	req.Query = strings.TrimSpace(req.Query)
	if req.Limit <= 0 {
		req.Limit = 10
	}
	if req.Limit > 30 {
		req.Limit = 30
	}
	req.Keywords = normalizeStrings(req.Keywords, 12, 40)
	req.Genres = normalizeStrings(req.Genres, 8, 40)
	req.Exclude = normalizeStrings(req.Exclude, 8, 40)
	if req.Query == "" && len(req.Keywords) > 0 {
		req.Query = strings.Join(req.Keywords, " ")
	}
	return req
}

func normalizeStrings(values []string, maxItems int, maxRunes int) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		trimmed = truncateRunes(trimmed, maxRunes)
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
		if len(result) >= maxItems {
			break
		}
	}
	return result
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}
