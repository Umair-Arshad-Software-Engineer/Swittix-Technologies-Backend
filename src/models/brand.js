const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Brand = sequelize.define('Brand', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: {
            type: DataTypes.STRING(100),
            allowNull: false,
            unique: true,
            validate: {
                notEmpty: { msg: 'Brand name is required' },
                len: { args: [2, 100], msg: 'Brand name must be between 2 and 100 characters' },
            },
        },
        description: { type: DataTypes.TEXT, allowNull: true },
        created_by: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'users', key: 'id' },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
        },
    }, {
        tableName: 'brands',
        timestamps: true,
        underscored: false,      // ✅ was true — FIXED
        createdAt: 'createdAt',  // ✅ added
        updatedAt: 'updatedAt',  // ✅ added
        indexes: [
            { fields: ['name'] },
            { fields: ['created_by'] },
        ],
    });

    return Brand;
};