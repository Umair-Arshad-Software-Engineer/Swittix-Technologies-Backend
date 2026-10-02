// src/models/customerPrice.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const CustomerPrice = sequelize.define('CustomerPrice', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        customer_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'customers', key: 'id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
        },
        product_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'products', key: 'id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
        },
        custom_price: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            validate: { min: { args: [0], msg: 'Price cannot be negative' } },
        },
        min_qty: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 1,
        },
        notes: { type: DataTypes.TEXT, allowNull: true, defaultValue: '' },
        is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        created_by: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'users', key: 'id' },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
        },
    }, {
        tableName: 'customer_prices',
        timestamps: true,
        underscored: false,
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
        indexes: [
            { unique: true, fields: ['customer_id', 'product_id', 'min_qty'] },
            { fields: ['customer_id'] },
            { fields: ['product_id'] },
        ],
    });

    return CustomerPrice;
};