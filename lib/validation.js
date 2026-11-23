function badRequest(message) { return Object.assign(new Error(message), { status: 400 }); }

function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw badRequest('Invalid UUID');
  }
  return value;
}

function name(value, label = 'Name') {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) throw badRequest(`${label} is required (maximum 500 characters)`);
  return value.trim();
}

function money(value, fallback) {
  if ((value === undefined || value === '') && fallback !== undefined) return fallback;
  if (!['string', 'number'].includes(typeof value) || !/^\d+(\.\d{1,2})?$/.test(String(value))) {
    throw badRequest('Price and deposits must be non-negative numbers with at most two decimals');
  }
  const result = Number(value);
  // Stay inside the range where two-decimal amounts remain safe as JSON numbers.
  if (!Number.isFinite(result) || result > 1000000000000) throw badRequest('Amount is too large');
  return result;
}

function motorcycle(body) {
  if (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 50000)) {
    throw badRequest('Description must be text (maximum 50000 characters)');
  }
  return {
    name: name(body.name), price: money(body.price), description: body.description || '',
    saigon_deposit: money(body.saigon_deposit, 0), province_deposit: money(body.province_deposit, 0),
    branch_id: body.branch_id ? uuid(body.branch_id) : null,
  };
}

function existingImages(value) {
  if (value === undefined) return [];
  let result;
  try { result = Array.isArray(value) ? value : JSON.parse(value); }
  catch { throw badRequest('existingImages must be a JSON array'); }
  if (!Array.isArray(result) || result.some((url) => typeof url !== 'string') || new Set(result).size !== result.length) {
    throw badRequest('existingImages must contain unique image URLs');
  }
  return result;
}

module.exports = { uuid, name, motorcycle, existingImages, badRequest };
