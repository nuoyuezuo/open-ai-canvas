package novel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"infinite-canvas/backend/internal/outbound"
)

const (
	maxSearchResponseBytes = 1 << 20
	searchRequestTimeout   = 20 * time.Second
)

// Host 由组合根注入，避免 novel → app/service 回环。
type Host interface {
	// EncryptSecret / DecryptSecret 复用平台设置密钥，检索凭据不落明文。
	EncryptSecret(value string) (string, error)
	DecryptSecret(value string) (string, error)
}

type nopHost struct{}

func (nopHost) EncryptSecret(value string) (string, error) { return value, nil }
func (nopHost) DecryptSecret(value string) (string, error) { return value, nil }

type Service struct {
	host Host
}

func New(host Host) *Service {
	if host == nil {
		host = nopHost{}
	}
	return &Service{host: host}
}

// ExternalLibraryConfig 是部署者在管理后台配置的外部小说资料库。
// 只有 URL 通过 SSRF 校验且显式启用时才参与检索。
type ExternalLibraryConfig struct {
	Enabled     bool              `json:"enabled"`
	Endpoint    string            `json:"endpoint"`
	APIKey      string            `json:"apiKey"`
	Headers     map[string]string `json:"headers"`
	Label       string            `json:"label"`
	LicenseNote string            `json:"licenseNote"`
}

type externalSearchResponse struct {
	Results []externalSearchItem `json:"results"`
}

type externalSearchItem struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Author    string   `json:"author"`
	URL       string   `json:"url"`
	Genres    []string `json:"genres"`
	Summary   string   `json:"summary"`
	Excerpt   string   `json:"excerpt"`
	WordCount int      `json:"wordCount"`
	License   string   `json:"license"`
}

// SearchExternal 查询部署者配置的外部资料库。未启用时返回空结果而不是报错，
// 让调用方可以自然地回落到「用户自备」与「模型检索」路径。
func (s *Service) SearchExternal(ctx context.Context, config ExternalLibraryConfig, req SearchRequest) ([]SearchResult, error) {
	if !config.Enabled {
		return nil, nil
	}
	req = NormalizeSearchRequest(req)
	endpoint, err := outbound.ValidateOutboundURL(config.Endpoint)
	if err != nil {
		return nil, err
	}
	if len(config.Headers) > 16 {
		return nil, outbound.BadAuthRequest("外部小说资料库自定义请求头最多 16 项")
	}
	apiKey, err := s.host.DecryptSecret(strings.TrimSpace(config.APIKey))
	if err != nil {
		return nil, err
	}
	body, err := json.Marshal(map[string]any{
		"query":    req.Query,
		"keywords": req.Keywords,
		"genres":   req.Genres,
		"exclude":  req.Exclude,
		"limit":    req.Limit,
	})
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), strings.NewReader(string(body)))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	}
	for name, value := range config.Headers {
		if !validSearchHeader(name, value) {
			return nil, outbound.BadAuthRequest("外部小说资料库请求头包含不允许的名称或取值")
		}
		httpReq.Header.Set(name, value)
	}
	outbound.ApplyDefaultOutboundHeaders(httpReq)
	resp, err := outbound.OutboundHTTPClient(searchRequestTimeout).Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("外部小说资料库请求失败：%w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("外部小说资料库返回失败：%s", resp.Status)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxSearchResponseBytes))
	if err != nil {
		return nil, err
	}
	var payload externalSearchResponse
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, errors.New("外部小说资料库返回格式错误")
	}
	results := make([]SearchResult, 0, len(payload.Results))
	for index, item := range payload.Results {
		if len(results) >= req.Limit {
			break
		}
		title := strings.TrimSpace(item.Title)
		if title == "" {
			continue
		}
		results = append(results, SearchResult{
			ID:              firstNonEmpty(strings.TrimSpace(item.ID), fmt.Sprintf("external-%d", index+1)),
			Title:           truncateRunes(title, 200),
			Author:          truncateRunes(strings.TrimSpace(item.Author), 120),
			Source:          SourceExternal,
			SourceLabel:     firstNonEmpty(strings.TrimSpace(config.Label), "外部资料库"),
			SourceURL:       safeResultURL(item.URL),
			Genres:          normalizeStrings(item.Genres, 8, 40),
			Summary:         truncateRunes(strings.TrimSpace(item.Summary), 1000),
			Excerpt:         truncateRunes(strings.TrimSpace(item.Excerpt), 1200),
			WordCount:       item.WordCount,
			CopyrightStatus: normalizeCopyrightStatus(item.License),
			LicenseNote:     truncateRunes(strings.TrimSpace(config.LicenseNote), 400),
		})
	}
	return results, nil
}

// safeResultURL 只保留 http/https 且不含认证信息的候选链接；其余置空，
// 避免把来源方返回的 javascript:/data: 链接透传到前端。
func safeResultURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.User != nil {
		return ""
	}
	return parsed.String()
}

func normalizeCopyrightStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "public-domain", "public_domain", "publicdomain":
		return "public-domain"
	case "cc", "creative-commons", "cc-by":
		return "creative-commons"
	case "licensed", "authorized":
		return "licensed"
	case "in-copyright", "copyrighted":
		return "in-copyright"
	default:
		return "unknown"
	}
}

func validSearchHeader(name string, value string) bool {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 120 || strings.ContainsAny(name, " \t\r\n:") {
		return false
	}
	if strings.ContainsAny(value, "\r\n") {
		return false
	}
	lower := strings.ToLower(name)
	switch lower {
	case "host", "content-length", "connection", "transfer-encoding", "authorization", "cookie":
		return false
	}
	return true
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
