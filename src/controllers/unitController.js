// controllers/unitController.js
const db = require('../models');

const formatUnit = (unit) => {
    const json = unit.toJSON();
    return {
        id: json.id,
        name: json.name,
        abbreviation: json.abbreviation || '',
        created_by: json.created_by,
        created_by_name: json.creator?.name || 'Unknown',
        created_at: json.created_at,
        updated_at: json.updated_at,
    };
};

// Get all units
const getAllUnits = async (req, res) => {
    try {
        const units = await db.Unit.findAll({
            include: [{
                association: 'creator',
                attributes: ['name'],
                required: false,
            }],
            order: [['name', 'ASC']],
        });

        res.json({
            success: true,
            units: units.map(formatUnit),
        });
    } catch (error) {
        console.error('getAllUnits error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Create unit
const createUnit = async (req, res) => {
    try {
        const { name, abbreviation } = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                message: 'Unit name is required',
            });
        }

        const unit = await db.Unit.create({
            name: name.trim(),
            abbreviation: abbreviation?.trim() || '',
            created_by: req.user.id,
        });

        const full = await db.Unit.findByPk(unit.id, {
            include: [{ association: 'creator', attributes: ['name'], required: false }],
        });

        res.status(201).json({
            success: true,
            unit: formatUnit(full),
            message: 'Unit created successfully',
        });
    } catch (error) {
        console.error('createUnit error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Update unit
const updateUnit = async (req, res) => {
    try {
        const unit = await db.Unit.findByPk(req.params.id);

        if (!unit) {
            return res.status(404).json({ success: false, message: 'Unit not found' });
        }

        const { name, abbreviation } = req.body;
        const updateData = {};

        if (name !== undefined) updateData.name = name.trim();
        if (abbreviation !== undefined) updateData.abbreviation = abbreviation.trim();

        await unit.update(updateData);

        const full = await db.Unit.findByPk(unit.id, {
            include: [{ association: 'creator', attributes: ['name'], required: false }],
        });

        res.json({
            success: true,
            unit: formatUnit(full),
            message: 'Unit updated successfully',
        });
    } catch (error) {
        console.error('updateUnit error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Delete unit
const deleteUnit = async (req, res) => {
    try {
        const unit = await db.Unit.findByPk(req.params.id);

        if (!unit) {
            return res.status(404).json({ success: false, message: 'Unit not found' });
        }

        await unit.destroy();

        res.json({ success: true, message: 'Unit deleted successfully' });
    } catch (error) {
        console.error('deleteUnit error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

module.exports = {
    getAllUnits,
    createUnit,
    updateUnit,
    deleteUnit,
};