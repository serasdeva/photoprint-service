const DRAFT_FIELDS = {
  services: [
    'title',
    'slug',
    'description',
    'price',
    'priceUnit',
    'icon',
    'order',
    'isActive',
    'removeImage',
  ],
  gallery: ['title', 'description', 'type', 'category', 'order', 'removeFile', 'removePoster'],
  settings: [
    'siteName',
    'phone',
    'email',
    'address',
    'workHours',
    'heroTitle',
    'heroSubtitle',
    'mapEmbed',
  ],
};

function saveAdminFormDraft(req, resource, id) {
  const fields = DRAFT_FIELDS[resource];
  if (!fields || !req.session) return;

  const values = {};
  fields.forEach((field) => {
    const value = req.body && req.body[field];
    if (typeof value === 'string') {
      values[field] = value.slice(0, field === 'mapEmbed' ? 12000 : 5000);
    }
  });

  if (resource === 'services' && !Object.prototype.hasOwnProperty.call(values, 'isActive')) {
    values.isActive = '';
  }

  req.session.adminFormDraft = { resource, id: id ? String(id) : '', values };
}

function consumeAdminFormDraft(req, resource, id) {
  if (!req.session || !req.session.adminFormDraft) return {};

  const draft = req.session.adminFormDraft;
  delete req.session.adminFormDraft;

  if (draft.resource !== resource || draft.id !== (id ? String(id) : '')) {
    return {};
  }

  return draft.values || {};
}

module.exports = { saveAdminFormDraft, consumeAdminFormDraft };
