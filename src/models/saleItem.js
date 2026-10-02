// models/SaleItem.js
module.exports = (sequelize, DataTypes) => {
    const SaleItem = sequelize.define('SaleItem', {
        id: { 
            type: DataTypes.INTEGER, 
            primaryKey: true, 
            autoIncrement: true 
        },
        sale_id: {
            type: DataTypes.INTEGER, 
            allowNull: false,
            references: { model: 'sales', key: 'id' },
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
        product_name: {
            type: DataTypes.STRING(255),
            allowNull: false,
            defaultValue: 'Unknown Product'
        },
        quantity: {
            type: DataTypes.INTEGER, 
            allowNull: false,
            validate: { 
                min: { args: [1], msg: 'Quantity must be at least 1' } 
            }
        },
        unit_price: { 
            type: DataTypes.DECIMAL(10, 2), 
            allowNull: false 
        },
        subtotal: { 
            type: DataTypes.DECIMAL(10, 2), 
            allowNull: false 
        },
        // ✅ Add tax fields
        tax_percentage: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: false,
            defaultValue: 0
        },
        tax_amount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0
        }
    }, {
        tableName: 'sale_items',
        timestamps: true,
        underscored: false,
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
        indexes: [
            { fields: ['sale_id'] },
            { fields: ['product_id'] }
        ]
    });

    return SaleItem;
};