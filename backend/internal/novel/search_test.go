package novel

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNormalizeSearchRequestBoundsInput(t *testing.T) {
	req := NormalizeSearchRequest(SearchRequest{
		Keywords: []string{"  海港  ", "", "海港", strings.Repeat("长", 80)},
		Genres:   []string{"都市"},
		Limit:    99,
	})
	if req.Limit != 30 {
		t.Fatalf("Limit = %d, want clamped 30", req.Limit)
	}
	if len(req.Keywords) != 2 {
		t.Fatalf("Keywords = %#v, want deduped and blank-filtered", req.Keywords)
	}
	if req.Keywords[0] != "海港" {
		t.Fatalf("Keywords[0] = %q, want trimmed", req.Keywords[0])
	}
	if len([]rune(req.Keywords[1])) != 40 {
		t.Fatalf("long keyword rune length = %d, want truncated to 40", len([]rune(req.Keywords[1])))
	}
	if req.Query != "海港 "+req.Keywords[1] {
		t.Fatalf("Query = %q, want derived from keywords", req.Query)
	}
}

func TestSearchExternalSkipsWhenDisabled(t *testing.T) {
	results, err := New(nil).SearchExternal(context.Background(), ExternalLibraryConfig{Enabled: false, Endpoint: "https://example.com/search"}, SearchRequest{Query: "海港"})
	if err != nil {
		t.Fatalf("SearchExternal() error = %v", err)
	}
	if len(results) != 0 {
		t.Fatalf("SearchExternal() = %#v, want empty when disabled", results)
	}
}

func TestSearchExternalRejectsPrivateEndpoint(t *testing.T) {
	_, err := New(nil).SearchExternal(context.Background(), ExternalLibraryConfig{Enabled: true, Endpoint: "http://127.0.0.1:9000/search"}, SearchRequest{Query: "海港"})
	if err == nil {
		t.Fatal("SearchExternal() error = nil, want SSRF rejection for loopback endpoint")
	}
}

func TestSearchExternalMapsResultsAndSanitizesLinks(t *testing.T) {
	// 测试服务器监听回环地址；显式放行与 custom_proxy_test.go 一致，生产仍默认拒绝。
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" {
			t.Errorf("Authorization = %q", r.Header.Get("Authorization"))
		}
		if r.Header.Get("X-Tenant") != "canvas" {
			t.Errorf("X-Tenant = %q", r.Header.Get("X-Tenant"))
		}
		payload := map[string]any{"results": []map[string]any{
			{"id": "n1", "title": "海港旧事", "author": "某人", "url": "javascript:alert(1)", "genres": []string{"都市"}, "summary": "摘要", "license": "in-copyright"},
			{"id": "", "title": "", "summary": "缺少标题"},
			{"id": "n3", "title": "第二本", "url": "https://example.com/n3", "license": "public-domain", "wordCount": 120000},
		}}
		_ = json.NewEncoder(w).Encode(payload)
	}))
	defer server.Close()
	host := testHost{}
	service := New(host)
	results, err := service.SearchExternal(context.Background(), ExternalLibraryConfig{
		Enabled: true, Endpoint: server.URL, APIKey: "secret", Label: "内部库",
		LicenseNote: "仅限授权改编", Headers: map[string]string{"X-Tenant": "canvas"},
	}, SearchRequest{Query: "海港", Limit: 10})
	if err != nil {
		t.Fatalf("SearchExternal() error = %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("results = %d, want 2 (blank title filtered)", len(results))
	}
	if results[0].SourceURL != "" {
		t.Fatalf("SourceURL = %q, want sanitized javascript: link removed", results[0].SourceURL)
	}
	if results[0].CopyrightStatus != "in-copyright" || results[0].LicenseNote != "仅限授权改编" {
		t.Fatalf("copyright metadata = %#v", results[0])
	}
	if results[1].CopyrightStatus != "public-domain" || results[1].WordCount != 120000 {
		t.Fatalf("second result = %#v", results[1])
	}
}

func TestSearchExternalRejectsForbiddenHeader(t *testing.T) {
	_, err := New(nil).SearchExternal(context.Background(), ExternalLibraryConfig{
		Enabled: true, Endpoint: "https://example.com/search", Headers: map[string]string{"Cookie": "session=1"},
	}, SearchRequest{Query: "海港"})
	if err == nil {
		t.Fatal("SearchExternal() error = nil, want forbidden header rejection")
	}
}

func TestBuildAdaptationSourceRequiresConfirmationForRetrievedText(t *testing.T) {
	_, err := BuildAdaptationSource(AdaptationSource{Kind: SourceExternal, Title: "海港旧事", Retrieved: true, Text: "第一段原文"}, false)
	if err == nil {
		t.Fatal("BuildAdaptationSource() error = nil, want confirmation requirement")
	}
	source, err := BuildAdaptationSource(AdaptationSource{Kind: SourceExternal, Title: "海港旧事", Retrieved: true, Text: strings.Repeat("原", 5000)}, true)
	if err != nil {
		t.Fatalf("BuildAdaptationSource() error = %v", err)
	}
	if len([]rune(source.Text)) != maxExcerptRunes {
		t.Fatalf("retrieved text rune length = %d, want truncated to %d", len([]rune(source.Text)), maxExcerptRunes)
	}
}

func TestBuildAdaptationSourceRejectsUnattributedText(t *testing.T) {
	if _, err := BuildAdaptationSource(AdaptationSource{Title: "自制", Text: "自有文本"}, false); err == nil {
		t.Fatal("BuildAdaptationSource() error = nil, want source attribution requirement")
	}
	if _, err := BuildAdaptationSource(AdaptationSource{Title: "自制", UserOwned: true, Text: "自有文本"}, false); err != nil {
		t.Fatalf("BuildAdaptationSource() error = %v, want user-owned text accepted", err)
	}
}

func TestCopyrightStatusLabel(t *testing.T) {
	if got := CopyrightStatusLabel("public-domain"); got != "已进入公共领域" {
		t.Fatalf("CopyrightStatusLabel() = %q", got)
	}
	if got := CopyrightStatusLabel("mystery"); got != "版权状态未知，需人工确认" {
		t.Fatalf("CopyrightStatusLabel() = %q", got)
	}
}

type testHost struct{}

func (testHost) EncryptSecret(value string) (string, error) { return value, nil }
func (testHost) DecryptSecret(value string) (string, error) { return value, nil }
