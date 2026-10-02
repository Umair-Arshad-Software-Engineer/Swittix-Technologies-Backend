// src/models/GoodsReceiptItem.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const GoodsReceiptItem = sequelize.define('GoodsReceiptItem', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        goods_receipt_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'goods_receipts', key: 'id' },
            onDelete: 'CASCADE',
        },
        purchase_order_item_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'purchase_order_items', key: 'id' },
            onDelete: 'SET NULL',
        },
        product_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'products', key: 'id' },
            onDelete: 'RESTRICT',
        },
        product_name: { type: DataTypes.STRING(200), allowNull: false },
        product_item_code: { type: DataTypes.STRING(50), allowNull: true },
        product_unit: { type: DataTypes.STRING(50), allowNull: true },
        // Quantities
        received_qty: { 
            type: DataTypes.DECIMAL(12, 3), 
            allowNull: false, 
            defaultValue: 0 
        },
        // Pricing
        unit_price: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        discount_percentage: { type: DataTypes.DECIMAL(5, 2), defaultValue: 0 },
        discount_amount: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        tax_percentage: { type: DataTypes.DECIMAL(5, 2), defaultValue: 0 },
        tax_amount: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        subtotal: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        total: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        // For batch/lot tracking (optional)
        batch_number: { type: DataTypes.STRING(100), allowNull: true },
        expiry_date: { type: DataTypes.DATEONLY, allowNull: true },
        // ✅ For offline sync
        local_uuid: { type: DataTypes.STRING(100), allowNull: true },
    }, {
        tableName: 'goods_receipt_items',
        timestamps: true,
        underscored: false,
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
        indexes: [
            { fields: ['goods_receipt_id'] },
            { fields: ['purchase_order_item_id'] },
            { fields: ['product_id'] },
        ],
    });

    return GoodsReceiptItem;
};