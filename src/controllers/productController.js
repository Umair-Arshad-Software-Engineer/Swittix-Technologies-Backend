const db = require('../models');
const { logPriceChange } = require('./priceHistoryController');

// ── Image size limit ──────────────────────────────────────────────────────
// Base64 is ~1 byte per character, so a 2 MB cap on the decoded image
// maps to a 2 MB cap on the string length. Keep this in sync with the
// client-side check in add_edit_product_page.dart.
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Returns null when the image is acceptable, or an error message string
 * when it is too large / malformed. Shared by create and update so the
 * rule lives in exactly one place.
 */
const validateImageSize = (imageData) => {
    if (imageData === undefined || imageData === null) return null;
    if (typeof imageData !== 'string') {
        return 'Image data must be a base64 string';
    }
    if (imageData.length > MAX_IMAGE_BYTES) {
        const sizeMB = (imageData.length / (1024 * 1024)).toFixed(2);
        return `Image is too large (${sizeMB} MB). Maximum allowed is 2.00 MB.`;
    }
    return null;
};

const formatProduct = (product) => {
    const json = product.toJSON();
    return {
        id: json.id,
        item_code: json.item_code,
        barcode: json.barcode,
        barcode_auto_generated: json.barcode_auto_generated,
        name: json.name,
        category_id: json.category_id,
        category_name: json.category?.name || null,
        brand_id: json.brand_id,
        brand_name: json.brand?.name || null,
        unit_id: json.unit_id,
        unit_name: json.unit?.name || null,
        unit_abbreviation: json.unit?.abbreviation || null,
        purchase_rate: parseFloat(json.purchase_rate),
        sale_rate: parseFloat(json.sale_rate),
        tax_percentage: parseFloat(json.tax_percentage),
        net_rate: parseFloat(json.net_rate),
        opening_qty: parseFloat(json.opening_qty),
        // ✅ FIX: was missing entirely, so the Flutter app never saw stock
        // move even though invoiceController.js deducts current_qty on
        // every invoice create/update/delete. Product.fromJson on the
        // client falls back to opening_qty when this is absent, which is
        // exactly the "stock never changes" symptom.
        current_qty: parseFloat(json.current_qty ?? json.opening_qty ?? 0),
        pct_code: json.pct_code || '',
        description: json.description || '',
        image_data: json.image_data || null,
        created_by: json.created_by,
        created_by_name: json.creator?.name || 'Unknown',
        created_at: json.created_at,
        updated_at: json.updated_at,
    };
};

// Helper: generate a unique item_code using the product's own id (race-condition safe)
const generateItemCode = (id) => {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    return `PRD-${dateStr}-${String(id).padStart(4, '0')}`;
};

// Helper: generate a barcode
const generateBarcode = () => {
    return `BAR-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
};

// Shared include config
const productIncludes = [
    { association: 'category', attributes: ['name'], required: false },
    { association: 'brand',    attributes: ['name'], required: false },
    { association: 'unit',     attributes: ['name', 'abbreviation'], required: false },
    { association: 'creator',  attributes: ['name'], required: false },
];

// Get all products
const getAllProducts = async (req, res) => {
    try {
        const products = await db.Product.findAll({
            include: productIncludes,
            order: [['id', 'DESC']],
        });

        res.json({
            success: true,
            products: products.map(formatProduct),
        });
    } catch (error) {
        console.error('getAllProducts error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Get single product
const getProduct = async (req, res) => {
    try {
        const product = await db.Product.findByPk(req.params.id, {
            include: productIncludes,
        });

        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        res.json({ success: true, product: formatProduct(product) });
    } catch (error) {
        console.error('getProduct error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Create product
const createProduct = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const {
            name,
            category_id,
            brand_id,
            unit_id,
            purchase_rate,
            sale_rate,
            tax_percentage = 0,
            opening_qty = 0,
            pct_code,
            description,
            barcode,
            barcode_auto_generated = true,
            image_data,
        } = req.body;

        // --- Validation ---
        if (!name || !name.trim()) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Product name is required' });
        }

        if (purchase_rate === undefined || purchase_rate === null) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Purchase rate is required' });
        }

        if (sale_rate === undefined || sale_rate === null) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Sale rate is required' });
        }

        // Server-side size cap — never trust the client alone.
        const imageError = validateImageSize(image_data);
        if (imageError) {
            await t.rollback();
            return res.status(400).json({ success: false, message: imageError });
        }

        const parsedPurchaseRate  = parseFloat(purchase_rate);
        const parsedSaleRate      = parseFloat(sale_rate);
        const parsedTaxPercentage = parseFloat(tax_percentage);
        const parsedOpeningQty    = parseFloat(opening_qty);

        if (isNaN(parsedPurchaseRate) || parsedPurchaseRate < 0) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Purchase rate must be a valid non-negative number' });
        }

        if (isNaN(parsedSaleRate) || parsedSaleRate < 0) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Sale rate must be a valid non-negative number' });
        }

        if (isNaN(parsedTaxPercentage) || parsedTaxPercentage < 0 || parsedTaxPercentage > 100) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Tax percentage must be between 0 and 100' });
        }

        if (isNaN(parsedOpeningQty) || parsedOpeningQty < 0) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Opening quantity must be a valid non-negative number' });
        }

        // Barcode validation (manual mode)
        if (!barcode_auto_generated && (!barcode || !barcode.trim())) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Barcode is required when manual mode is selected' });
        }

        // --- Build the record ---
        const netRate = parsedSaleRate * (1 + parsedTaxPercentage / 100);

        const productData = {
            item_code:            'TEMP',           // overwritten below
            name:                 name.trim(),
            category_id:          category_id  || null,
            brand_id:             brand_id     || null,
            unit_id:              unit_id      || null,
            purchase_rate:        parsedPurchaseRate,
            sale_rate:            parsedSaleRate,
            tax_percentage:       parsedTaxPercentage,
            net_rate:             netRate,
            opening_qty:          parsedOpeningQty,
            // ✅ FIX: current_qty must start equal to opening_qty, or every
            // new product begins life at 0 stock regardless of what the
            // user entered as opening quantity.
            current_qty:          parsedOpeningQty,
            pct_code:             pct_code?.trim()     || null,
            description:          description?.trim()  || '',
            barcode_auto_generated,
            barcode:              barcode_auto_generated
                                    ? generateBarcode()
                                    : barcode.trim(),
            image_data: image_data || null,
            created_by:           req.user.id,
        };

        const product = await db.Product.create(productData, { hooks: false, transaction: t });

        const finalItemCode = generateItemCode(product.id);
        await product.update({ item_code: finalItemCode }, { hooks: false, transaction: t });

        await logPriceChange({
            entityType: 'product',
            productId: product.id,
            fieldName: 'purchase_rate',
            oldValue: null,
            newValue: parsedPurchaseRate,
            changedBy: req.user.id,
            reason: 'Initial purchase rate',
        }, t);

        await logPriceChange({
            entityType: 'product',
            productId: product.id,
            fieldName: 'sale_rate',
            oldValue: null,
            newValue: parsedSaleRate,
            changedBy: req.user.id,
            reason: 'Initial sale rate',
        }, t);

        if (parsedTaxPercentage !== 0) {
            await logPriceChange({
                entityType: 'product',
                productId: product.id,
                fieldName: 'tax_percentage',
                oldValue: null,
                newValue: parsedTaxPercentage,
                changedBy: req.user.id,
                reason: 'Initial tax percentage',
            }, t);
        }

        await t.commit();

        const full = await db.Product.findByPk(product.id, { include: productIncludes });

        return res.status(201).json({
            success: true,
            product: formatProduct(full),
            message: 'Product created successfully',
        });
    } catch (error) {
        await t.rollback();
        console.error('createProduct error:', error);
        if (error.name === 'SequelizeValidationError') {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.errors.map(e => ({ field: e.path, message: e.message })),
            });
        }
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(409).json({
                success: false,
                message: 'A product with this barcode or item code already exists',
            });
        }
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
};

// Update product
const updateProduct = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const product = await db.Product.findByPk(req.params.id, { transaction: t });

        if (!product) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        const {
            name,
            category_id,
            brand_id,
            unit_id,
            purchase_rate,
            sale_rate,
            tax_percentage,
            opening_qty,
            pct_code,
            description,
            barcode,
            barcode_auto_generated,
            image_data,
            change_reason = '',
        } = req.body;

        const updateData = {};

        if (name !== undefined) {
            if (!name.trim()) {
                await t.rollback();
                return res.status(400).json({ success: false, message: 'Product name cannot be empty' });
            }
            updateData.name = name.trim();
        }

        if (image_data !== undefined) {
            const imageError = validateImageSize(image_data);
            if (imageError) {
                await t.rollback();
                return res.status(400).json({ success: false, message: imageError });
            }
            updateData.image_data = image_data || null; // allow explicit clear by sending null
        }

        if (category_id !== undefined) updateData.category_id = category_id || null;
        if (brand_id     !== undefined) updateData.brand_id    = brand_id    || null;
        if (unit_id      !== undefined) updateData.unit_id     = unit_id     || null;
        if (pct_code     !== undefined) updateData.pct_code    = pct_code?.trim()    || null;
        if (description  !== undefined) updateData.description = description?.trim() || '';

        // Capture "before" values up front — needed for history diffs.
        const oldPurchaseRate  = parseFloat(product.purchase_rate);
        const oldSaleRate      = parseFloat(product.sale_rate);
        const oldTaxPercentage = parseFloat(product.tax_percentage);
        const oldNetRate       = parseFloat(product.net_rate);
        const oldOpeningQty    = parseFloat(product.opening_qty);
        const oldCurrentQty    = parseFloat(product.current_qty || 0);

        if (opening_qty !== undefined) {
            const parsedQty = parseFloat(opening_qty);
            if (isNaN(parsedQty) || parsedQty < 0) {
                await t.rollback();
                return res.status(400).json({ success: false, message: 'Opening quantity must be a valid non-negative number' });
            }
            updateData.opening_qty = parsedQty;

            // ✅ FIX: if opening_qty is edited, shift current_qty by the same
            // delta rather than leaving current_qty untouched (which would
            // silently disconnect it from opening_qty) or resetting it to
            // the new opening_qty (which would wipe out any stock already
            // sold/received since creation).
            const delta = parsedQty - oldOpeningQty;
            updateData.current_qty = oldCurrentQty + delta;
        }

        let parsedPurchaseRate  = null;
        let parsedSaleRate      = null;
        let parsedTaxPercentage = null;

        if (purchase_rate !== undefined) {
            parsedPurchaseRate = parseFloat(purchase_rate);
            if (isNaN(parsedPurchaseRate) || parsedPurchaseRate < 0) {
                await t.rollback();
                return res.status(400).json({ success: false, message: 'Purchase rate must be a valid non-negative number' });
            }
            updateData.purchase_rate = parsedPurchaseRate;
        }

        if (sale_rate !== undefined) {
            parsedSaleRate = parseFloat(sale_rate);
            if (isNaN(parsedSaleRate) || parsedSaleRate < 0) {
                await t.rollback();
                return res.status(400).json({ success: false, message: 'Sale rate must be a valid non-negative number' });
            }
            updateData.sale_rate = parsedSaleRate;
        }

        if (tax_percentage !== undefined) {
            parsedTaxPercentage = parseFloat(tax_percentage);
            if (isNaN(parsedTaxPercentage) || parsedTaxPercentage < 0 || parsedTaxPercentage > 100) {
                await t.rollback();
                return res.status(400).json({ success: false, message: 'Tax percentage must be between 0 and 100' });
            }
            updateData.tax_percentage = parsedTaxPercentage;
        }

        // Handle barcode change
        if (barcode_auto_generated !== undefined) {
            updateData.barcode_auto_generated = barcode_auto_generated;
            if (barcode_auto_generated) {
                updateData.barcode = generateBarcode();
            } else if (barcode && barcode.trim()) {
                updateData.barcode = barcode.trim();
            } else {
                await t.rollback();
                return res.status(400).json({ success: false, message: 'Barcode is required when manual mode is selected' });
            }
        }

        // Always recalculate net_rate using the latest values
        const finalSaleRate      = parsedSaleRate      !== null ? parsedSaleRate      : oldSaleRate;
        const finalTaxPercentage = parsedTaxPercentage !== null ? parsedTaxPercentage : oldTaxPercentage;
        updateData.net_rate = finalSaleRate * (1 + finalTaxPercentage / 100);

        await product.update(updateData, { hooks: false, transaction: t });

        // ─── Price history logging ─────────────────────────────────────────
        if (updateData.purchase_rate !== undefined && updateData.purchase_rate !== oldPurchaseRate) {
            await logPriceChange({
                entityType: 'product',
                productId: product.id,
                fieldName: 'purchase_rate',
                oldValue: oldPurchaseRate,
                newValue: updateData.purchase_rate,
                changedBy: req.user.id,
                reason: change_reason,
            }, t);
        }

        if (updateData.sale_rate !== undefined && updateData.sale_rate !== oldSaleRate) {
            await logPriceChange({
                entityType: 'product',
                productId: product.id,
                fieldName: 'sale_rate',
                oldValue: oldSaleRate,
                newValue: updateData.sale_rate,
                changedBy: req.user.id,
                reason: change_reason,
            }, t);
        }

        if (updateData.tax_percentage !== undefined && updateData.tax_percentage !== oldTaxPercentage) {
            await logPriceChange({
                entityType: 'product',
                productId: product.id,
                fieldName: 'tax_percentage',
                oldValue: oldTaxPercentage,
                newValue: updateData.tax_percentage,
                changedBy: req.user.id,
                reason: change_reason,
            }, t);
        }

        if (updateData.net_rate !== undefined && updateData.net_rate !== oldNetRate) {
            await logPriceChange({
                entityType: 'product',
                productId: product.id,
                fieldName: 'net_rate',
                oldValue: oldNetRate,
                newValue: updateData.net_rate,
                changedBy: req.user.id,
                reason: change_reason,
            }, t);
        }

        await t.commit();

        const full = await db.Product.findByPk(product.id, { include: productIncludes });

        return res.json({
            success: true,
            product: formatProduct(full),
            message: 'Product updated successfully',
        });
    } catch (error) {
        await t.rollback();
        console.error('updateProduct error:', error);
        if (error.name === 'SequelizeValidationError') {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.errors.map(e => ({ field: e.path, message: e.message })),
            });
        }
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(409).json({
                success: false,
                message: 'A product with this barcode already exists',
            });
        }
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
};

// Delete product
const deleteProduct = async (req, res) => {
    try {
        const product = await db.Product.findByPk(req.params.id);

        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        await product.destroy();

        res.json({ success: true, message: 'Product deleted successfully' });
    } catch (error) {
        console.error('deleteProduct error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

module.exports = {
    getAllProducts,
    getProduct,
    createProduct,
    updateProduct,
    deleteProduct,
};