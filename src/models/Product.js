const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Product = sequelize.define('Product', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        item_code: { type: DataTypes.STRING(50), allowNull: false, unique: true },
        barcode: { type: DataTypes.STRING(100), allowNull: true, unique: true },
        barcode_auto_generated: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        name: {
            type: DataTypes.STRING(200),
            allowNull: false,
            validate: {
                notEmpty: { msg: 'Product name is required' },
                len: { args: [2, 200], msg: 'Product name must be between 2 and 200 characters' },
            },
        },
        category_id: {
            type: DataTypes.INTEGER, allowNull: true,
            references: { model: 'categories', key: 'id' },
            onDelete: 'SET NULL', onUpdate: 'CASCADE',
        },
        brand_id: {
            type: DataTypes.INTEGER, allowNull: true,
            references: { model: 'brands', key: 'id' },
            onDelete: 'SET NULL', onUpdate: 'CASCADE',
        },
        unit_id: {
            type: DataTypes.INTEGER, allowNull: true,
            references: { model: 'units', key: 'id' },
            onDelete: 'SET NULL', onUpdate: 'CASCADE',
        },
        purchase_rate: {
            type: DataTypes.DECIMAL(10, 2), allowNull: false,
            validate: {
                isDecimal: { msg: 'Purchase rate must be a valid number' },
                min: { args: [0], msg: 'Purchase rate cannot be negative' },
            },
        },
        sale_rate: {
            type: DataTypes.DECIMAL(10, 2), allowNull: false,
            validate: {
                isDecimal: { msg: 'Sale rate must be a valid number' },
                min: { args: [0], msg: 'Sale rate cannot be negative' },
            },
        },
        tax_percentage: {
            type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0,
            validate: {
                min: { args: [0], msg: 'Tax percentage cannot be negative' },
                max: { args: [100], msg: 'Tax percentage cannot exceed 100' },
            },
        },
        net_rate: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
        opening_qty: {
            type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0,
            validate: { min: { args: [0], msg: 'Opening quantity cannot be negative' } },
        },
        current_qty: { type: DataTypes.DECIMAL(12, 3), defaultValue: 0 },
        pct_code: { type: DataTypes.STRING(50), allowNull: true },
        description: { type: DataTypes.TEXT, allowNull: true, defaultValue: '' },
        image_data: { type: DataTypes.TEXT('long'), allowNull: true }, // base64-encoded image
        created_by: {
            type: DataTypes.INTEGER, allowNull: true,
            references: { model: 'users', key: 'id' },
            onDelete: 'SET NULL', onUpdate: 'CASCADE',
        },
    }, {
        tableName: 'products',
        timestamps: true,
        underscored: false,      // ✅ was true — FIXED
        createdAt: 'createdAt',  // ✅ added
        updatedAt: 'updatedAt',  // ✅ added
        indexes: [
            { fields: ['item_code'] },
            { fields: ['barcode'] },
            { fields: ['name'] },
            { fields: ['category_id'] },
            { fields: ['brand_id'] },
            { fields: ['unit_id'] },
            { fields: ['purchase_rate'] },
            { fields: ['sale_rate'] },
            { fields: ['created_by'] },
        ],
        hooks: {
            beforeCreate: async (product) => {
                if (!product.item_code || product.item_code === 'TEMP') {
                    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
                    product.item_code = `PRD-${dateStr}-${Date.now()}`;
                }
                if (product.barcode_auto_generated && !product.barcode) {
                    product.barcode = `BAR-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
                }
                product.net_rate = parseFloat(product.sale_rate) * (1 + parseFloat(product.tax_percentage) / 100);
            },
            beforeUpdate: async (product) => {
                if (product.changed('sale_rate') || product.changed('tax_percentage')) {
                    product.net_rate = parseFloat(product.sale_rate) * (1 + parseFloat(product.tax_percentage) / 100);
                }
            },
        },
    });

    return Product;
};