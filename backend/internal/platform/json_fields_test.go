package platform

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestOptionalJSONStringRejectsWrongType(t *testing.T) {
	payload := map[string]any{"id": 12.0, "status": "ok"}

	text, err := OptionalJSONString(payload, "status")
	if err != nil || text != "ok" {
		t.Fatalf("OptionalJSONString(status) = %q, %v", text, err)
	}

	text, err = OptionalJSONString(payload, "missing")
	if err != nil || text != "" {
		t.Fatalf("OptionalJSONString(missing) = %q, %v", text, err)
	}

	_, err = OptionalJSONString(payload, "id")
	if err == nil || !strings.Contains(err.Error(), "expected string") || !strings.Contains(err.Error(), "float64") {
		t.Fatalf("OptionalJSONString(id) error = %v", err)
	}
}

func TestRequireJSONString(t *testing.T) {
	payload := map[string]any{"id": "task-1", "empty": "  "}

	text, err := RequireJSONString(payload, "id")
	if err != nil || text != "task-1" {
		t.Fatalf("RequireJSONString(id) = %q, %v", text, err)
	}

	_, err = RequireJSONString(payload, "empty")
	if err == nil || !strings.Contains(err.Error(), "missing field: empty") {
		t.Fatalf("RequireJSONString(empty) error = %v", err)
	}

	_, err = RequireJSONString(map[string]any{"id": true}, "id")
	if err == nil || !strings.Contains(err.Error(), "expected string") {
		t.Fatalf("RequireJSONString(bool) error = %v", err)
	}
}

func TestFirstJSONStringPrefersValidStringOverWrongType(t *testing.T) {
	payload := map[string]any{"id": 99.0, "task_id": "abc"}

	text, err := FirstJSONString(payload, "id", "task_id")
	if err != nil || text != "abc" {
		t.Fatalf("FirstJSONString() = %q, %v", text, err)
	}

	_, err = FirstJSONString(payload, "id", "request_id")
	if err == nil || !strings.Contains(err.Error(), "field id") {
		t.Fatalf("FirstJSONString() error = %v", err)
	}

	text, err = FirstJSONString(payload, "missing", "also-missing")
	if err != nil || text != "" {
		t.Fatalf("FirstJSONString(missing) = %q, %v", text, err)
	}
}

// TestFeatureAvailabilityBackfillsComicFieldsForExistingSetting 覆盖升级场景：
// 数据库里已有旧配置（没有 comicEnabled / comicDramaEnabled）时，新字段必须回填为默认开放，
// 否则前端 parseFeatureAvailability 会因缺少布尔字段而整页报错，功能开放面板打不开。
func TestFeatureAvailabilityBackfillsComicFieldsForExistingSetting(t *testing.T) {
	value := DefaultFeatureAvailability()
	legacy := `{"welcomeEnabled":true,"shortDramaEnabled":false,"taskCenterEnabled":false,"creditsEnabled":false,"customChannelsEnabled":false,"frontendModelsEnabled":false,"pluginCenterEnabled":false,"systemPluginsVisibleToUsers":false}`
	if err := json.Unmarshal([]byte(legacy), &value); err != nil {
		t.Fatalf("旧配置必须能被解析: %v", err)
	}
	if !value.ComicEnabled || !value.ComicDramaEnabled {
		t.Fatalf("旧配置缺少漫画字段时应回填默认开放: %+v", value)
	}
	if value.ShortDramaEnabled || value.TaskCenterEnabled {
		t.Fatalf("旧配置中已存在的字段不应被默认值覆盖: %+v", value)
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"comicEnabled", "comicDramaEnabled"} {
		if _, ok := decoded[key].(bool); !ok {
			t.Fatalf("序列化结果必须包含布尔字段 %s: %s", key, encoded)
		}
	}
}
