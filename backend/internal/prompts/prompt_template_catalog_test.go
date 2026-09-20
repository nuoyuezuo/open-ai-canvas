package prompts

import (
	"strings"
	"testing"
)

func TestPromptOperationCatalogContainsProductJobs(t *testing.T) {
	want := []string{
		OperationChapterAssetsExtract,
		OperationStoryboardPlan,
		OperationStoryboardRepair,
		OperationStoryboardFirstFrame,
		OperationStoryboardVideo,
		OperationCharacterExtract,
		OperationCharacterTurnaround,
		OperationShortDramaOutline,
		OperationSkillDraft,
		OperationComicPanelScript,
		OperationNovelAdaptation,
		OperationNovelSearchQuery,
	}
	got := make(map[string]bool, len(want))
	for _, definition := range defaultPromptDefinitions() {
		got[definition.Operation] = true
	}
	for _, operation := range want {
		if !got[operation] {
			t.Fatalf("prompt catalog missing operation %s", operation)
		}
	}
	if len(got) != len(want) {
		t.Fatalf("prompt catalog size = %d, want %d; update this lock list when adding an operation", len(got), len(want))
	}
}

func TestRenderShortDramaTemplateSubstitutesVariables(t *testing.T) {
	definition, ok := PromptDefinition(OperationShortDramaOutline)
	if !ok {
		t.Fatal("short_drama_outline definition missing")
	}
	rendered, err := RenderPromptTemplate(definition, definition.DefaultContent, map[string]string{
		"章节数量": "5",
		"叙事结构": "单线推进",
		"每章字数": "800",
		"叙事视角": "第三人称",
		"整体基调": "平稳叙事",
		"角色规模": "3-4 个",
		"章节篇幅": "中",
	})
	if err != nil {
		t.Fatalf("RenderPromptTemplate() error = %v", err)
	}
	if !strings.Contains(rendered, "5 个章节") || !strings.Contains(rendered, "单线推进") || strings.Contains(rendered, "{{") {
		t.Fatalf("RenderPromptTemplate() = %q, want interpolated short-drama instruction", rendered)
	}
	protected := protectedPromptContext(OperationShortDramaOutline, map[string]string{"用户故事": "租客发现房东不是人"})
	if !strings.Contains(protected, "租客发现房东不是人") || !strings.Contains(protected, "short-drama-outline/v1") {
		t.Fatalf("protectedPromptContext() = %q, want story and JSON contract", protected)
	}
}

func TestValidatePromptTemplateResultShortDramaOutline(t *testing.T) {
	ok := `{"title":"夜灯","synopsis":"租客发现房东不是人","chapters":[{"title":"入住","content":"林夏搬进旧公寓。"}]}`
	if err := ValidatePromptTemplateResult(OperationShortDramaOutline, map[string]interface{}{"text": "```json\n" + ok + "\n```"}); err != nil {
		t.Fatalf("valid outline error = %v", err)
	}
	if err := ValidatePromptTemplateResult(OperationShortDramaOutline, map[string]interface{}{"text": `{"title":"夜灯","synopsis":"简介","chapters":[]}`}); err == nil || !strings.Contains(err.Error(), "没有生成任何章节") {
		t.Fatalf("empty chapters error = %v", err)
	}
}

func TestValidatePromptTemplateResultSkillDraft(t *testing.T) {
	ok := `{"skillName":"分镜节奏","tag":"drama","description":"把章节拆成可执行镜头","instruction":"角色设定：分镜导演。"}`
	if err := ValidatePromptTemplateResult(OperationSkillDraft, map[string]interface{}{"text": ok}); err != nil {
		t.Fatalf("valid skill draft error = %v", err)
	}
	if err := ValidatePromptTemplateResult(OperationSkillDraft, map[string]interface{}{"text": `{"skillName":"分镜节奏","tag":"drama","description":"简介"}`}); err == nil || !strings.Contains(err.Error(), "instruction") {
		t.Fatalf("missing instruction error = %v", err)
	}
	protected := protectedPromptContext(OperationSkillDraft, map[string]string{"用户想法": "做一个电商主图技能"})
	if !strings.Contains(protected, "做一个电商主图技能") || !strings.Contains(protected, "skill-draft/v1") {
		t.Fatalf("protectedPromptContext() = %q, want idea and JSON contract", protected)
	}
}

func TestValidatePromptTemplateResultComicPanelScript(t *testing.T) {
	valid := `{"title":"雨夜信使","panels":[{"panelNumber":1,"layout":"整页横幅","shotSize":"远景","scene":"雨后街道","characters":["信使"],"action":"跃过积水","dialogue":[{"kind":"narration","speaker":"","text":"凌晨三点。"}],"imagePrompt":"低角度全景，霓虹倒影","negativePrompt":"文字水印"}]}`
	if err := ValidatePromptTemplateResult(OperationComicPanelScript, map[string]interface{}{"text": "```json\n" + valid + "\n```"}); err != nil {
		t.Fatalf("valid panel script error = %v", err)
	}
	if err := ValidatePromptTemplateResult(OperationComicPanelScript, map[string]interface{}{"text": `{"title":"雨夜信使","panels":[]}`}); err == nil || !strings.Contains(err.Error(), "没有生成任何画格") {
		t.Fatalf("empty panels error = %v", err)
	}
	if err := ValidatePromptTemplateResult(OperationComicPanelScript, map[string]interface{}{"text": `{"title":"雨夜信使","panels":[{"panelNumber":1,"layout":"整页","shotSize":"远景","scene":"街道","action":"跳跃","imagePrompt":"","dialogue":[]}]}`}); err == nil || !strings.Contains(err.Error(), "imagePrompt") {
		t.Fatalf("missing imagePrompt error = %v", err)
	}
	protected := protectedPromptContext(OperationComicPanelScript, map[string]string{"项目名称": "雨夜信使", "章节名称": "第一章", "项目画风": "黑白网点", "章节正文": "信使跃过积水。"})
	if !strings.Contains(protected, "comic-panel-script/v1") || !strings.Contains(protected, "信使跃过积水。") {
		t.Fatalf("protectedPromptContext() = %q, want chapter text and JSON contract", protected)
	}
}

func TestValidatePromptTemplateResultNovelAdaptationRequiresCompliance(t *testing.T) {
	valid := `{"title":"潮汐记事","synopsis":"小镇少年追查失踪的潮汐钟。","world":"架空海港城邦","characters":[{"name":"林澈","role":"主角","appearance":"瘦高","personality":"执拗","relationship":"与姐姐相依为命"}],"episodes":[{"title":"第一章 潮声","summary":"发现停摆的钟","content":"林澈在码头醒来。"}],"compliance":{"similarities":["同属海港成长母题"],"risks":["主角职业相近"],"notes":"已重建人物与世界观"}}`
	if err := ValidatePromptTemplateResult(OperationNovelAdaptation, map[string]interface{}{"text": valid}); err != nil {
		t.Fatalf("valid adaptation error = %v", err)
	}
	// 合规字段是防侵权的硬约束，缺失时必须拒绝落库。
	if err := ValidatePromptTemplateResult(OperationNovelAdaptation, map[string]interface{}{"text": `{"title":"潮汐记事","synopsis":"简介","world":"架空","characters":[{"name":"林澈","role":"主角"}],"episodes":[{"title":"第一章","content":"正文"}]}`}); err == nil || !strings.Contains(err.Error(), "compliance") {
		t.Fatalf("missing compliance error = %v", err)
	}
}

func TestValidatePromptTemplateResultNovelSearchQuery(t *testing.T) {
	if err := ValidatePromptTemplateResult(OperationNovelSearchQuery, map[string]interface{}{"text": `{"keywords":["海港","成长"],"genres":["都市"],"exclude":["血腥"],"note":"仅检索公开资料"}`}); err != nil {
		t.Fatalf("valid search query error = %v", err)
	}
	if err := ValidatePromptTemplateResult(OperationNovelSearchQuery, map[string]interface{}{"text": `{"keywords":[],"genres":[],"exclude":[],"note":""}`}); err == nil || !strings.Contains(err.Error(), "keywords") {
		t.Fatalf("empty keywords error = %v", err)
	}
}
