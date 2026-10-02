const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Unit = sequelize.define('Unit', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: {
            type: DataTypes.STRING(50),
            allowNull: false,
            unique: true,
            validate: {
                notEmpty: { msg: 'Unit name is required' },
                len: { args: [1, 50], msg: 'Unit name must be between 1 and 50 characters' },
            },
        },
        abbreviation: { type: DataTypes.STRING(10), allowNull: true },
        created_by: {
            type: DataTypes.INTEGER,
            allowNull: true,
            // references: { model: 'units', key: 'id' },
            references: { model: 'users', key: 'id' },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
        },
    }, {
        tableName: 'units',
        timestamps: true,
        underscored: false,      // ✅ was true — FIXED
        createdAt: 'createdAt',  // ✅ added
        updatedAt: 'updatedAt',  // ✅ added
        indexes: [
            { fields: ['name'] },
            { fields: ['created_by'] },
        ],
    });

    return Unit;
};