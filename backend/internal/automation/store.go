package automation

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"mongoui/internal/config"
)

// Store keeps automation configuration in the coordination MongoDB when a
// lease is available, so every instance sees the same alert/runbook rules.
// Without a lease it falls back to the local settings file (single instance).
type Store struct {
	settings *config.Settings
	coll     *mongo.Collection
}

func NewStore(settings *config.Settings, lease *Lease) *Store {
	store := &Store{settings: settings}
	if lease != nil {
		store.coll = lease.Collection("automation")
	}
	return store
}

type automationDoc struct {
	Alerts              []config.AlertRule             `bson:"alerts"`
	Runbooks            []config.Runbook               `bson:"runbooks"`
	Reports             []config.ReportRule            `bson:"reports"`
	SMTP                config.SMTPSettings            `bson:"smtp"`
	SavedQueries        map[string][]config.SavedQuery `bson:"savedQueries"`
	SavedQueriesVersion map[string]int64               `bson:"savedQueriesVersion"`
}

func (s *Store) load() (automationDoc, error) {
	var doc automationDoc
	if s.coll == nil {
		return doc, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := s.coll.FindOne(ctx, bson.M{"_id": "config"}).Decode(&doc)
	if err == mongo.ErrNoDocuments {
		return doc, nil
	}
	return doc, err
}

func (s *Store) update(field string, value any) error {
	return s.updateFields(bson.M{field: value})
}

func (s *Store) updateFields(fields bson.M) error {
	if s.coll == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := s.coll.UpdateOne(ctx,
		bson.M{"_id": "config"},
		bson.M{"$set": fields},
		options.Update().SetUpsert(true),
	)
	return err
}

func (s *Store) GetAlerts() ([]config.AlertRule, error) {
	if s.coll == nil {
		return s.settings.GetAlerts()
	}
	doc, err := s.load()
	if err != nil {
		return nil, err
	}
	for i := range doc.Alerts {
		if doc.Alerts[i].WebhookSecret, err = s.settings.DecryptSecret(doc.Alerts[i].WebhookSecret); err != nil {
			return nil, err
		}
	}
	return doc.Alerts, nil
}

func (s *Store) SetAlerts(rules []config.AlertRule) error {
	if s.coll == nil {
		return s.settings.SetAlerts(rules)
	}
	encrypted := make([]config.AlertRule, len(rules))
	copy(encrypted, rules)
	for i := range encrypted {
		secret, err := s.settings.EncryptSecret(encrypted[i].WebhookSecret)
		if err != nil {
			return err
		}
		encrypted[i].WebhookSecret = secret
	}
	return s.update("alerts", encrypted)
}

func (s *Store) GetRunbooks() []config.Runbook {
	if s.coll == nil {
		return s.settings.GetRunbooks()
	}
	doc, err := s.load()
	if err != nil {
		return nil
	}
	return doc.Runbooks
}

func (s *Store) SetRunbooks(runbooks []config.Runbook) error {
	if s.coll == nil {
		return s.settings.SetRunbooks(runbooks)
	}
	return s.update("runbooks", runbooks)
}

func (s *Store) GetReports() ([]config.ReportRule, error) {
	if s.coll == nil {
		return s.settings.GetReports()
	}
	doc, err := s.load()
	if err != nil {
		return nil, err
	}
	for i := range doc.Reports {
		if doc.Reports[i].WebhookSecret, err = s.settings.DecryptSecret(doc.Reports[i].WebhookSecret); err != nil {
			return nil, err
		}
	}
	return doc.Reports, nil
}

func (s *Store) SetReports(reports []config.ReportRule) error {
	if s.coll == nil {
		return s.settings.SetReports(reports)
	}
	encrypted := make([]config.ReportRule, len(reports))
	copy(encrypted, reports)
	for i := range encrypted {
		secret, err := s.settings.EncryptSecret(encrypted[i].WebhookSecret)
		if err != nil {
			return err
		}
		encrypted[i].WebhookSecret = secret
	}
	return s.update("reports", encrypted)
}

func (s *Store) GetSMTP() (config.SMTPSettings, error) {
	if s.coll == nil {
		return s.settings.GetSMTP()
	}
	doc, err := s.load()
	if err != nil {
		return config.SMTPSettings{}, err
	}
	if doc.SMTP.Password != "" {
		doc.SMTP.Password, err = s.settings.DecryptSecret(doc.SMTP.Password)
	}
	return doc.SMTP, err
}

func (s *Store) SetSMTP(cfg config.SMTPSettings) error {
	if s.coll == nil {
		return s.settings.SetSMTP(cfg)
	}
	encrypted, err := s.settings.EncryptSecret(cfg.Password)
	if err != nil {
		return err
	}
	cfg.Password = encrypted
	return s.update("smtp", cfg)
}

func (s *Store) GetSavedQueries(scope string) []config.SavedQuery {
	if s.coll == nil {
		return s.settings.GetSavedQueries(scope)
	}
	doc, err := s.load()
	if err != nil {
		return nil
	}
	queries := doc.SavedQueries[scope]
	out := make([]config.SavedQuery, len(queries))
	copy(out, queries)
	return out
}

func (s *Store) SavedQueriesRevision(scope string) int64 {
	if s.coll == nil {
		return s.settings.SavedQueriesRevision(scope)
	}
	doc, err := s.load()
	if err != nil {
		return 0
	}
	return doc.SavedQueriesVersion[scope]
}

func (s *Store) SetSavedQueries(scope string, queries []config.SavedQuery, expected *int64) (int64, error) {
	if s.coll == nil {
		return s.settings.SetSavedQueries(scope, queries, expected)
	}
	doc, err := s.load()
	if err != nil {
		return 0, err
	}
	if doc.SavedQueries == nil {
		doc.SavedQueries = map[string][]config.SavedQuery{}
	}
	if doc.SavedQueriesVersion == nil {
		doc.SavedQueriesVersion = map[string]int64{}
	}
	current := doc.SavedQueriesVersion[scope]
	if expected != nil && *expected != current {
		return current, config.ErrSavedQueriesConflict
	}
	if len(queries) == 0 {
		delete(doc.SavedQueries, scope)
	} else {
		doc.SavedQueries[scope] = append([]config.SavedQuery(nil), queries...)
	}
	next := current + 1
	doc.SavedQueriesVersion[scope] = next
	if err := s.updateFields(bson.M{
		"savedQueries":        doc.SavedQueries,
		"savedQueriesVersion": doc.SavedQueriesVersion,
	}); err != nil {
		return next, err
	}
	return next, nil
}
