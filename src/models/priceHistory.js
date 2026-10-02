const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const PriceHistory = sequelize.define('PriceHistory', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

        // 'product'        -> a product's own purchase/sale/tax rate changed
        // 'customer_price' -> a customer-specific override was created/changed
        entity_type: {
            type: DataTypes.ENUM('product', 'customer_price'),
            allowNull: false,
        },

        product_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'products', key: 'id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
        },

        customer_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'customers', key: 'id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
        },
        customer_price_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'customer_prices', key: 'id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
        },

        // e.g. 'purchase_rate' | 'sale_rate' | 'tax_percentage' | 'net_rate' | 'custom_price' | 'min_qty'
        field_name: { type: DataTypes.STRING(50), allowNull: false },

        old_value: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
        new_value: { type: DataTypes.DECIMAL(10, 2), allowNull: false },

        changed_by: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'users', key: 'id' },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
        },

        change_reason: { type: DataTypes.TEXT, allowNull: true },
    }, {
        tableName: 'price_history',
        timestamps: true,
        underscored: false,
        createdAt: 'createdAt',
        updatedAt: false,
        indexes: [
            { fields: ['product_id'] },
            { fields: ['customer_id'] },
            { fields: ['customer_price_id'] },
            { fields: ['entity_type'] },
            { fields: ['field_name'] },
            { fields: ['createdAt'] },
        ],
    });

    return PriceHistory;
};