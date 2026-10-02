// src/models/PurchaseOrderItem.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const PurchaseOrderItem = sequelize.define('PurchaseOrderItem', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        purchase_order_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'purchase_orders', key: 'id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
        },
        product_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'products', key: 'id' },
            onDelete: 'RESTRICT',
            onUpdate: 'CASCADE',
        },
        // Snapshot fields (in case product changes later)
        product_name: { type: DataTypes.STRING(200), allowNull: false },
        product_item_code: { type: DataTypes.STRING(50), allowNull: true },
        product_unit: { type: DataTypes.STRING(50), allowNull: true },
        // Quantities
        ordered_qty: { 
            type: DataTypes.DECIMAL(12, 3), 
            allowNull: false, 
            defaultValue: 0 
        },
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
        // Notes
        description: { type: DataTypes.TEXT, allowNull: true, defaultValue: '' },
        // ✅ For offline sync
        local_uuid: { type: DataTypes.STRING(100), allowNull: true },
    }, {
        tableName: 'purchase_order_items',
        timestamps: true,
        underscored: false,
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
        indexes: [
            { fields: ['purchase_order_id'] },
            { fields: ['product_id'] },
        ],
    });

    return PurchaseOrderItem;
};