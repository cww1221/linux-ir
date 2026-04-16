package playbook

import (
	"bytes"
	"embed"
	"errors"
	"fmt"
	"sort"
	"strings"
	"text/template"

	"gopkg.in/yaml.v3"
)

//go:embed *.yaml
var embedded embed.FS

type Item struct {
	ID          string            `yaml:"id" json:"id"`
	Name        string            `yaml:"name" json:"name"`
	Category    string            `yaml:"category" json:"category"`
	Command     string            `yaml:"command" json:"command"`
	TimeoutSec  int               `yaml:"timeoutSec" json:"timeoutSec"`
	NeedsRoot   bool              `yaml:"needsRoot" json:"needsRoot"`
	Description string            `yaml:"description" json:"description"`
	Tags        []string          `yaml:"tags" json:"tags"`
	Vars        map[string]string `yaml:"vars" json:"vars"`
	// RemediateID 可选：检测项执行后可在界面上一键调用的「处置/加固采集」剧本 ID（不自动破坏数据，需人工确认后再做删文件/杀进程）。
	RemediateID string `yaml:"remediateId" json:"remediateId"`
}

type Document struct {
	Version string `yaml:"version" json:"version"`
	Title   string `yaml:"title" json:"title"`
	Items   []Item `yaml:"items" json:"items"`
}

type Catalog struct {
	Docs []Document `json:"docs"`
}

func LoadEmbeddedCatalog() (Catalog, error) {
	names := []string{
		"linux_full.yaml",
		"mining_checks.yaml",
		"web_log_analysis.yaml",
		"webshell_scan.yaml",
		"autoir.yaml",
		"integrity_offline.yaml",
	}
	var docs []Document
	for _, n := range names {
		b, err := embedded.ReadFile(n)
		if err != nil {
			return Catalog{}, err
		}
		var d Document
		if err := yaml.Unmarshal(b, &d); err != nil {
			return Catalog{}, fmt.Errorf("%s 解析失败: %w", n, err)
		}
		docs = append(docs, d)
	}
	return Catalog{Docs: docs}, nil
}

func (c Catalog) AllItems() []Item {
	var out []Item
	for _, d := range c.Docs {
		out = append(out, d.Items...)
	}
	return out
}

func (c Catalog) FindByID(id string) (Item, bool) {
	id = strings.TrimSpace(id)
	if id == "" {
		return Item{}, false
	}
	for _, it := range c.AllItems() {
		if it.ID == id {
			return it, true
		}
	}
	return Item{}, false
}

func RenderCommand(it Item, vars map[string]string) (string, error) {
	if strings.TrimSpace(it.Command) == "" {
		return "", errors.New("command 为空")
	}
	m := map[string]string{}
	for k, v := range it.Vars {
		m[k] = v
	}
	for k, v := range vars {
		m[k] = v
	}

	tpl, err := template.New("cmd").Option("missingkey=zero").Parse(it.Command)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if err := tpl.Execute(&buf, m); err != nil {
		return "", err
	}
	return strings.TrimSpace(buf.String()), nil
}

func Categories(items []Item) []string {
	set := map[string]struct{}{}
	for _, it := range items {
		if it.Category != "" {
			set[it.Category] = struct{}{}
		}
	}
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

