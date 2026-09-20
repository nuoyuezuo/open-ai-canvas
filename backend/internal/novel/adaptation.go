package novel

import (
	"errors"
	"strings"
)

// maxAdaptationSourceRunes 限制送入改编模型的素材长度。检索结果通常只有摘要和短摘录，
// 超长说明调用方试图把全文塞进模型，必须显式确认素材归属后才能继续。
const maxAdaptationSourceRunes = 20000

// maxExcerptRunes 是单条检索摘录允许进入改编上下文的上限，避免整章原文被复制。
const maxExcerptRunes = 1200

// BuildAdaptationSource 组装改编素材并做防侵权前置校验：
// 检索来源必须带版权状态说明，未知状态时要求用户确认自担责任。
func BuildAdaptationSource(source AdaptationSource, userConfirmed bool) (AdaptationSource, error) {
	source.Title = truncateRunes(strings.TrimSpace(source.Title), 200)
	source.Author = truncateRunes(strings.TrimSpace(source.Author), 120)
	source.SourceURL = strings.TrimSpace(source.SourceURL)
	source.Text = strings.TrimSpace(source.Text)
	if source.Text == "" {
		return AdaptationSource{}, errors.New("改编素材不能为空")
	}
	if source.Retrieved && !userConfirmed {
		return AdaptationSource{}, errors.New("检索到的小说必须先确认改编授权，才能进入改编流程")
	}
	if !source.Retrieved && !source.UserOwned {
		return AdaptationSource{}, errors.New("请说明素材来源：上传自有文本，或先检索并确认授权")
	}
	if source.Retrieved {
		// 检索路径只允许携带短摘录，避免把受版权保护的原文整体交给模型复现。
		source.Text = truncateRunes(source.Text, maxExcerptRunes)
	}
	if len([]rune(source.Text)) > maxAdaptationSourceRunes {
		return AdaptationSource{}, errors.New("改编素材过长，请分段处理")
	}
	return source, nil
}

// AdaptationGuard 描述改编结果必须满足的防侵权检查项，供前端展示和人工复核。
type AdaptationGuard struct {
	RebuiltCharacters  bool     `json:"rebuiltCharacters"`
	RebuiltWorld       bool     `json:"rebuiltWorld"`
	RenamedProperNouns bool     `json:"renamedProperNouns"`
	Similarities       []string `json:"similarities"`
	Risks              []string `json:"risks"`
	Notes              string   `json:"notes"`
}

// CopyrightStatusLabel 把来源声明的版权状态转成用户可读说明。
func CopyrightStatusLabel(status string) string {
	switch status {
	case "public-domain":
		return "已进入公共领域"
	case "creative-commons":
		return "采用知识共享许可"
	case "licensed":
		return "来源声明已授权"
	case "in-copyright":
		return "仍在版权保护期"
	default:
		return "版权状态未知，需人工确认"
	}
}
